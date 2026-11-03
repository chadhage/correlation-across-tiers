package com.contoso.replay;

import static org.junit.jupiter.api.Assertions.*;
import com.contoso.messaging.Source;
import org.junit.jupiter.api.Test;

class ReplayMainTest {
    @Test void cliOnlyAddressesFrozenRequestedWorkSources() {
        assertEquals(Source.ORDERS_DLQ, ReplayMain.source(new String[]{"--source", "ORDERS_DLQ"}));
        for (String[] args : new String[][]{{}, {"--source", "ORDERS"}, {"--source", "unknown"}, {"--source", "ORDERS_DLQ", "--force"}}) {
            assertThrows(IllegalArgumentException.class, () -> ReplayMain.source(args));
        }
    }
}
