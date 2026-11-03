import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = name => readFile(new URL(`../../workers/messaging-core/src/test/java/com/contoso/messaging/${name}.java`,
  import.meta.url), 'utf8');

test('SOURCE ONLY: Notify replay and the other topic subscription run in separate fixed-role child JVM phases', async () => {
  const [harness, probe, fixture] = await Promise.all([
    source('AsyncNativeAgentTest'), source('NotifyTopicReplayProbe'), source('NotifyTopicReplayFixture')
  ]);
  assert.match(harness, /AsyncNativeProbe\.class\.getName\(\), List\.of\(\)/);
  assert.match(harness, /for \(String phase : List\.of\("prepare", "notify", "skip"\)\)/);
  assert.match(harness, /NotifyTopicReplayProbe\.role\(phase\), NotifyTopicReplayProbe\.class\.getName\(\)/);
  assert.match(harness, /new ProcessBuilder\(arguments\)/);
  assert.match(harness, /children\.stream\(\)\.map\(ChildExecution::pid\)\.distinct\(\)\.count\(\)/);
  assert.match(probe, /case "prepare", "skip" -> "contoso-fulfillment-worker"/);
  assert.match(probe, /case "notify" -> "contoso-notify-worker"/);
  assert.match(probe, /role\.equals\(System\.getenv\("APPLICATIONINSIGHTS_ROLE_NAME"\)\)/);
  assert.match(probe, /case "notify" -> fixture\.notifyReplay\(operation\)/);
  const notify = fixture.slice(fixture.indexOf('Map<String, Object> notifyReplay('),
    fixture.indexOf('Map<String, Object> skipOtherTopicSubscription('));
  assert.match(notify, /new AsyncProcessor\(notifyStore, settings\)/);
  assert.match(notify, /new ReplayProcessor\(notifyStore, settings\)\.replay\(deadLetter, true\)/);
  assert.doesNotMatch(notify, /new AsyncProcessor\(.*FULFILLMENT|new ReplayProcessor\(.*FULFILLMENT/);
  assert.match(harness, /node\.path\("tags"\)\.path\("ai\.cloud\.role"\)\.asText\(\)/);
  assert.doesNotMatch(harness, /(?:node|span)\.put\("roleName"|put\("ai\.cloud\.role"/);
});

test('SOURCE ONLY: actual trusted store, NOTIFY_DLQ replay and non-target settlement/effect/fault checks are executable', async () => {
  const fixture = await source('NotifyTopicReplayFixture');
  for (const fragment of [
    'new PgMessagingStore(factory(role), codec)', 'DriverManager.getConnection(url, role, "")',
    'new AzureCarriers(codec)', 'carriers.serviceBus(message.getBody(), message.getMessageId(), message.getApplicationProperties())',
    'List.of(Destination.SERVICE_BUS_TOPIC)', 'transport.one(Source.NOTIFY_DLQ)',
    'deadLetter.source() == Source.NOTIFY_DLQ',
    'new RunControl(RunAction.REPLAY, WorkTarget.NOTIFY, 0)',
    'notifyStore.prepareReplay(original, Source.NOTIFY_DLQ, operation)',
    'new OutboxPublisher(notifyStore, transport).dispatch(8)',
    '!fulfillment.replayRequested(original.workflowId(), Source.FULFILLMENT_DLQ, operation)',
    'fulfillment.prepareReplay(original, Source.FULFILLMENT_DLQ, operation)',
    'catch (DataAccessException expected)',
    'new AsyncProcessor(fulfillment, settings).process(delivery, Branch.FULFILLMENT)',
    'delivery.completed', 'COMPOSITE_SOURCE_RECORD', 'COMPOSITE_IDEMPOTENCY',
    'TRUSTED_REPLAY_OWNER', 'TRUSTED_NOTIFY_PRINCIPAL_COLUMN_', 'source_publisher',
    'result.get("fulfillmentReplayInbox").equals(0)', 'result.get("notifyEffects").equals(1)',
    'result.get("fulfillmentFaultBudget").equals(3)', 'result.get("fulfillmentPaused").equals(true)',
    'result.get("retainedFulfillmentDeadLetters").equals(1)', ';IFEXISTS=TRUE'
  ]) assert(fixture.includes(fragment), fragment);
  assert.doesNotMatch(fixture, /Correlation\.start|contoso\.replay\.process|contoso\.replay\.send|setAttribute/);
  assert.doesNotMatch(fixture, /CREATE TABLE contoso\.async_|UPDATE contoso\.async_|INSERT INTO contoso\.async_/);
});

test('SOURCE REGRESSION ONLY: ORDER Notify provenance uses the exact protected publication, not RESULT-only inbox source metadata', async () => {
  const [fixture, production] = await Promise.all([
    source('NotifyTopicReplayFixture'),
    readFile(new URL('../../workers/messaging-core/src/main/java/com/contoso/messaging/PgMessagingStore.java',
      import.meta.url), 'utf8')
  ]);
  assert.match(production, /if \(envelope\.kind\(\) == Envelope\.Kind\.RESULT\) resultReceipt\(connection, envelope, branch\)/);
  assert.match(production, /INSERT INTO contoso\.async_inbox\(message_id,branch\) VALUES/);
  assert.match(fixture, /factory\(MessagingFixture\.NOTIFY\)\.open\(\)/);
  assert.match(fixture, /executeQuery\("SELECT CURRENT_USER"\)/);
  assert.match(fixture, /value instanceof String && currentUser\.equals\(value\)/);
  assert.match(fixture, /SELECT e\.owner,i\.receiver,p\.publisher,i\.source_publisher,p\.envelope_json/);
  assert.match(fixture, /p\.destination='SERVICE_BUS_TOPIC' AND p\.envelope_hash=\?/);
  assert.match(fixture, /query\.setString\(1, codec\.fingerprint\(replay\)\)/);
  assert.match(fixture, /codec\.json\(replay\)\.equals\(rows\.getString\(5\)\)/);
  assert.match(fixture, /rows\.getObject\(4\) == null, "ORDER_INBOX_HAS_NO_RESULT_PUBLISHER"/);
  assert.doesNotMatch(fixture, /SET source_publisher|INSERT INTO contoso\.async_inbox/);
});

test('SOURCE ONLY: shared original-first approval precedes all projections and both independent replay roots link actual original IDs', async () => {
  const [harness, adapter, unit] = await Promise.all([
    source('AsyncNativeAgentTest'), source('NativeTestCapture'), source('NotifyTopicReplayFixtureTest')
  ]);
  assert.equal((harness.match(/new NativeTestCapture\(\)/g) ?? []).length, 1);
  assert(harness.indexOf('capture.approve(root)') < harness.indexOf('.map(AsyncNativeAgentTest::runtimeState)'));
  assert(harness.indexOf('capture.approve(root)') < harness.indexOf('NativeTestCapture.writeNew('));
  for (const fragment of [
    'assertTrue(parent(process).isEmpty())', 'assertTrue(parent(send).isEmpty())',
    'assertNotEquals(trace(process), trace(send))',
    'assertNotEquals(trace(original), trace(process))', 'assertNotEquals(trace(original), trace(send))',
    'assertEquals(trace(original), actualLinks.getFirst().path("operation_Id").asText())',
    'assertEquals(id(original), actualLinks.getFirst().path("id").asText())',
    'assertEquals(id(send), parent(effect))', 'assertEquals(id(send), parent(other))',
    'property(send, "contoso.original.message.id")',
    'property(send, "contoso.causation.id")', '"SKIPPED_TARGET"', '"notifyReplayRuntimeResults"',
    '"nativeSafeInspectionSha256"', 'ASYNC_NATIVE_CAPTURE_RECEIPT'
  ]) assert(harness.includes(fragment), fragment);
  assert.doesNotMatch(harness, /property\(process, "contoso\.message\.id"\)/);
  assert.match(adapter, /PAYLOAD_COUNT_LIMIT = 16/);
  assert.match(adapter, /TOTAL_BYTE_LIMIT = 4 \* PAYLOAD_LIMIT/);
  assert.match(adapter, /ENVELOPE_LIMIT = 512/);
  assert.match(adapter, /StandardOpenOption\.CREATE_NEW/);
  assert.equal((unit.match(/@Test\s+void/g) ?? []).length, 3);
  assert.doesNotMatch(unit, /@TempDir|java\.io\.tmpdir/);
});
