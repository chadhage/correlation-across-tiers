import { createHash } from 'node:crypto';

const prefix = 'contoso-corr-poc-';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function frozenNames(subscriptionId, location, environmentName = 'poc') {
  if (!uuid.test(subscriptionId) || !/^[a-z][a-z0-9]+$/.test(location) || environmentName !== 'poc') throw new Error('Invalid Contoso naming scope');
  const discriminator = createHash('sha256').update(`${subscriptionId}\n${location}\n${environmentName}`, 'utf8').digest('hex').slice(0, 6);
  return {
    schema: 'contoso.physical-names.v1',
    environmentName,
    location,
    discriminator,
    resourceGroup: `${prefix}rg-${discriminator}`,
    network: `${prefix}vnet-${discriminator}`,
    plan: `${prefix}plan-${discriminator}`,
    orders: `${prefix}orders-${discriminator}`,
    inventory: `${prefix}inv-${discriminator}`,
    fulfillment: `${prefix}fulfill-${discriminator}`,
    notify: `${prefix}notify-${discriminator}`,
    aggregator: `${prefix}agg-${discriminator}`,
    portal: `${prefix}portal-${discriminator}`,
    apim: `${prefix}apim-${discriminator}`,
    keyVault: `${prefix}kv-${discriminator.slice(0, 4)}`,
    postgres: `${prefix}pg-${discriminator}`,
    redis: `${prefix}amr-${discriminator}`,
    serviceBus: `${prefix}sb-${discriminator}`,
    eventGrid: `${prefix}egt-${discriminator}`,
    eventHubs: `${prefix}eh-${discriminator}`,
    storage: `contosocorrpocst${discriminator}`,
    appInsights: `${prefix}appi`,
    workspace: `${prefix}law`,
    roles: {
      storefront: 'contoso-storefront-spa',
      portal: 'contoso-portal-ssr',
      orders: 'contoso-orders-api',
      inventory: 'contoso-inventory-api',
      fulfillment: 'contoso-fulfillment-worker',
      notify: 'contoso-notify-worker',
      aggregator: 'contoso-order-aggregator'
    }
  };
}

export function validateFrozenNames(names) {
  if (names.schema !== 'contoso.physical-names.v1' || !/^[0-9a-f]{6}$/.test(names.discriminator)) throw new Error('Invalid frozen naming schema/discriminator');
  if (!/^[a-z0-9]{3,24}$/.test(names.storage) || !names.storage.startsWith('contosocorrpocst')) throw new Error('Invalid normalized storage name');
  if (names.keyVault.length > 24 || !/^[a-z][a-z0-9-]+[a-z0-9]$/.test(names.keyVault)) throw new Error('Invalid Key Vault name');
  if (names.serviceBus.endsWith('-sb') || names.serviceBus.endsWith('-mgmt')) throw new Error('Reserved Service Bus namespace suffix');
  for (const key of ['resourceGroup', 'network', 'plan', 'orders', 'inventory', 'fulfillment', 'notify', 'aggregator', 'portal', 'apim', 'keyVault', 'postgres', 'redis', 'serviceBus', 'eventGrid', 'eventHubs', 'appInsights', 'workspace']) {
    if (!names[key]?.startsWith(prefix)) throw new Error(`Non-Contoso physical name: ${key}`);
  }
  for (const key of ['orders', 'inventory', 'fulfillment', 'notify', 'aggregator', 'portal']) {
    if (names[key].length > 32) throw new Error(`Approved host-name length exceeded: ${key}`);
  }
  const expected = ['contoso-storefront-spa', 'contoso-portal-ssr', 'contoso-orders-api', 'contoso-inventory-api', 'contoso-fulfillment-worker', 'contoso-notify-worker', 'contoso-order-aggregator'];
  if (JSON.stringify(Object.values(names.roles)) !== JSON.stringify(expected)) throw new Error('Canonical roles changed');
}
