package com.contoso.correlation;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class BoundedRequestBodyTest {
    @Test void declaredSizeIsRejectedBeforeAnyAsyncOwnershipTransfer() throws Exception {
        var request = new MockHttpServletRequest("POST", "/api/orders");
        request.setContent(new byte[BoundedRequestBody.LIMIT + 1]);
        var response = new MockHttpServletResponse();
        var closes = new AtomicInteger();
        assertNull(BoundedRequestBody.begin(request, response, Instant.now().plusSeconds(1), closes::incrementAndGet));
        assertEquals(413, response.getStatus());
        assertEquals(0, closes.get());
        assertFalse(request.isAsyncStarted());
    }

    @Test void expiryCannotStartReadingOrAsyncWork() throws Exception {
        var request = new MockHttpServletRequest("POST", "/api/orders");
        request.setContent(new byte[]{1});
        var response = new MockHttpServletResponse();
        assertNull(BoundedRequestBody.begin(request, response, Instant.now().minusSeconds(1), () -> {}));
        assertEquals(408, response.getStatus());
        assertFalse(request.isAsyncStarted());
        assertTrue(response.getContentAsString().contains("REQUEST_TIMEOUT"));
    }

    @Test void ordinaryBodylessGetDoesNotRequireAsyncSupportOrCloseTheCallerPermit() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/inventory/CONTOSO-001");
        var closes = new AtomicInteger();
        try (var body = BoundedRequestBody.begin(request, new MockHttpServletResponse(), Instant.now().plusSeconds(1),
                closes::incrementAndGet)) {
            assertNotNull(body);
            assertFalse(body.asynchronous());
            assertEquals(0, body.bytes().length);
        }
        assertEquals(0, closes.get());
    }

    @Test void unsupportedAsyncInputFailsClosedInsteadOfBlockingReadNBytes() throws Exception {
        var request = new MockHttpServletRequest("POST", "/api/orders");
        request.setContent(new byte[]{1, 2, 3});
        var response = new MockHttpServletResponse();
        assertNull(BoundedRequestBody.begin(request, response, Instant.now().plusSeconds(1), () -> {}));
        assertEquals(503, response.getStatus());
        assertTrue(response.getContentAsString().contains("BODY_READER_UNAVAILABLE"));
    }
}
