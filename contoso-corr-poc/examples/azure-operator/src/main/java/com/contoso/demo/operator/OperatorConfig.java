package com.contoso.demo.operator;

import com.contoso.security.WorkloadIdentity;
import java.net.URI;
import java.time.Instant;
import java.util.Map;

record OperatorConfig(String tenantId, String audience, WorkloadIdentity controller,
                      URI gateway, String ordersResource, String workspaceId, String appInsightsResourceId,
                      String computePlanResourceId, String apimDiagnosticResourceId,
                      Instant startsAt, Instant expiresAt, String approvalReference) {
    OperatorConfig {
        tenantId = guid(tenantId);
        audience = guid(audience);
        workspaceId = guid(workspaceId);
        if (controller == null || startsAt == null || expiresAt == null ||
            !expiresAt.isAfter(startsAt) || expiresAt.isAfter(startsAt.plusSeconds(7200)) ||
            approvalReference == null || !approvalReference.matches("[A-Za-z0-9._:/-]{1,256}") ||
            ordersResource == null || !ordersResource.matches("api://[0-9a-f-]{36}")) throw OperatorFailure.invalid();
        https(gateway);
        if (!gateway.getPath().equals("/contoso/v1")) throw OperatorFailure.invalid();
        resource(appInsightsResourceId, "Microsoft.Insights/components");
        resource(computePlanResourceId, "Microsoft.Web/serverfarms");
        if (apimDiagnosticResourceId == null || !apimDiagnosticResourceId.matches(
            "/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourceGroups/[A-Za-z0-9_.()-]*contoso[A-Za-z0-9_.()-]*/providers/" +
            "Microsoft\\.ApiManagement/service/contoso-[a-z0-9-]+/diagnostics/applicationinsights")) {
            throw OperatorFailure.invalid();
        }
    }

    static OperatorConfig fromEnvironment(Map<String, String> env) {
        if (!"true".equals(env.get("CONTOSO_ISOLATED_DEMO_OPERATOR"))) throw new IllegalStateException("ISOLATED_OPERATOR_REQUIRED");
        return new OperatorConfig(required(env, "CONTOSO_TENANT_ID"), required(env, "CONTOSO_OPERATOR_AUDIENCE"),
            new WorkloadIdentity(required(env, "CONTOSO_OPERATOR_CONTROLLER_CLIENT_ID"),
                required(env, "CONTOSO_OPERATOR_CONTROLLER_OBJECT_ID")),
            URI.create(required(env, "CONTOSO_OPERATOR_GATEWAY_URL")), required(env, "CONTOSO_OPERATOR_ORDERS_RESOURCE"),
            required(env, "CONTOSO_OPERATOR_WORKSPACE_ID"), required(env, "CONTOSO_OPERATOR_APPINSIGHTS_RESOURCE_ID"),
            required(env, "CONTOSO_OPERATOR_COMPUTE_PLAN_RESOURCE_ID"),
            required(env, "CONTOSO_OPERATOR_APIM_DIAGNOSTIC_RESOURCE_ID"),
            Instant.parse(required(env, "CONTOSO_OPERATOR_START")), Instant.parse(required(env, "CONTOSO_OPERATOR_END")),
            required(env, "CONTOSO_OPERATOR_APPROVAL_REFERENCE"));
    }

    void requireActive(Instant now) {
        if (now.isBefore(startsAt) || !now.isBefore(expiresAt)) throw new OperatorFailure(409, "OPERATOR_WINDOW_INACTIVE");
    }

    static void https(URI uri) {
        if (uri == null || !"https".equals(uri.getScheme()) || uri.getHost() == null ||
            uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null ||
            uri.getPort() != -1) throw OperatorFailure.invalid();
    }

    static void resource(String id, String type) {
        if (id == null || !id.matches("/subscriptions/474c40eb-d385-40d8-baa2-06883dbdca2d/resourceGroups/" +
                "[A-Za-z0-9_.()-]*contoso[A-Za-z0-9_.()-]*/providers/" + java.util.regex.Pattern.quote(type) + "/contoso-[A-Za-z0-9-]+")) {
            throw OperatorFailure.invalid();
        }
    }

    static String guid(String value) {
        if (value == null || value.length() != 36 || !java.util.UUID.fromString(value).toString().equals(value) ||
            value.equals("00000000-0000-0000-0000-000000000000")) throw OperatorFailure.invalid();
        return value;
    }

    static String required(Map<String, String> env, String key) {
        String value = env.get(key);
        if (value == null || value.isBlank()) throw new IllegalStateException(key + "_REQUIRED");
        return value;
    }
}
