package com.contoso.messaging;

import java.time.Instant;

public interface Delivery {
    Source source();
    Envelope envelope();
    int deliveryCount();
    Instant lockedUntil();
    Instant renew();
    void complete();
    void abandon();
    void deadLetter(String safeReason);
}
