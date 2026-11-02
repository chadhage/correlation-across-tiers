package com.contoso.messaging;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public final class ProcessingLease implements AutoCloseable {
    private static final ScheduledExecutorService RENEWALS = Executors.newScheduledThreadPool(2, action -> {
        Thread thread = new Thread(action, "contoso-broker-lock-renewal");
        thread.setDaemon(true);
        return thread;
    });
    private final Delivery delivery;
    private final Clock clock;
    private final ScheduledFuture<?> renewal;
    private Instant expires;
    private boolean valid = true;
    private boolean settled;

    public ProcessingLease(Delivery delivery) { this(delivery, Clock.systemUTC(), Duration.ofSeconds(10)); }
    ProcessingLease(Delivery delivery, Clock clock, Duration interval) {
        this.delivery = delivery; this.clock = clock; this.expires = delivery.lockedUntil();
        renewal = RENEWALS.scheduleWithFixedDelay(this::renewNow, interval.toMillis(), interval.toMillis(), TimeUnit.MILLISECONDS);
    }

    synchronized void renewNow() {
        if (settled || !valid) return;
        try {
            check();
            expires = delivery.renew();
        } catch (RuntimeException ignored) { valid = false; }
    }
    public synchronized void check() {
        if (!valid || settled || expires == null || !expires.isAfter(clock.instant())) {
            valid = false;
            throw new MessagingFailure(MessagingFailure.Code.LOCK_LOST);
        }
    }
    public synchronized void complete() { settle(delivery::complete); }
    public synchronized void abandon() { settle(delivery::abandon); }
    public synchronized void deadLetter(String code) { settle(() -> delivery.deadLetter(code)); }
    private void settle(Runnable action) {
        check();
        renewal.cancel(false);
        try { action.run(); settled = true; }
        catch (RuntimeException ignored) { valid = false; throw new MessagingFailure(MessagingFailure.Code.LOCK_LOST); }
    }
    @Override public synchronized void close() { renewal.cancel(false); }
}
