[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$directory = Join-Path $project 'apim\policies\fragments'
$documents = @{}
foreach ($file in [IO.Directory]::GetFiles($directory, '*.xml')) {
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [Xml.XmlReader]::Create($file, $settings)
    try {
        $document = [Xml.XmlDocument]::new()
        $document.XmlResolver = $null
        $document.Load($reader)
        $documents[[IO.Path]::GetFileName($file)] = $document
    }
    finally { $reader.Dispose() }
}

function Expression([string] $file, [string] $xpath, [string] $attribute = 'value') {
    $node = $documents[$file].SelectSingleNode($xpath)
    if ($null -eq $node) { throw 'Required deployed policy expression is missing.' }
    $value = $node.GetAttribute($attribute)
    if ($value.StartsWith('@{') -and $value.EndsWith('}')) { return $value.Substring(2, $value.Length - 3) }
    if ($value.StartsWith('@(') -and $value.EndsWith(')')) { return "return ($($value.Substring(2, $value.Length - 3)));" }
    throw 'Unsupported deployed policy expression form.'
}

$inputDocument = [Console]::In.ReadToEnd() | ConvertFrom-Json -AsHashtable
$portalClientIds = if ($inputDocument.Contains('portalClientIds')) {
    ($inputDocument.portalClientIds | ForEach-Object { $_.ToLowerInvariant() }) -join ','
} else { '11111111-2222-4333-8444-555555555555' }
$parent = Expression 'contoso-context-v1.xml' '/fragment/set-variable[@name="contoso.traceparentDisposition"]'
$state = Expression 'contoso-context-v1.xml' '/fragment/set-variable[@name="contoso.tracestateValid"]'
$deleteParent = Expression 'contoso-context-v1.xml' '/fragment/choose/when[1]' 'condition'
$deleteState = Expression 'contoso-context-v1.xml' '/fragment/choose/when[2]' 'condition'
$business = Expression 'contoso-business-id-v1.xml' '/fragment/set-variable[@name="contoso.businessDisposition"]'
$businessId = Expression 'contoso-business-id-v1.xml' '/fragment/set-variable[@name="contoso.businessId"]'
$authorization = Expression 'contoso-authn-v1.xml' '/fragment/set-variable[@name="contoso.authHeaderValid"]'
$delegated = (Expression 'contoso-authz-v1.xml' '/fragment/set-variable[@name="contoso.callerDelegated"]').Replace('{{contoso-delegated-scope}}', 'Orders.Invoke')
$issuer = (Expression 'contoso-authz-v1.xml' '/fragment/set-variable[@name="contoso.callerTrustedInvocationIssuer"]').Replace('{{contoso-portal-client-ids}}', $portalClientIds)

# The policy expressions are unchanged; only APIM's context/Jwt carrier types are local test bindings.
Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

public sealed class ContosoApimProbeRequest {
    public Dictionary<string, string[]> Headers = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
}
public sealed class ContosoApimProbeContext {
    public ContosoApimProbeRequest Request = new ContosoApimProbeRequest();
    public Dictionary<string, object> Variables = new Dictionary<string, object>();
}
public sealed class Jwt {
    public Dictionary<string, string[]> Claims = new Dictionary<string, string[]>();
}
public static class ContosoApimPolicyProbe {
    public static string Parent(ContosoApimProbeContext context) { $parent }
    public static bool State(ContosoApimProbeContext context) { $state }
    public static bool DeleteParent(ContosoApimProbeContext context) { $deleteParent }
    public static bool DeleteState(ContosoApimProbeContext context) { $deleteState }
    public static string Business(ContosoApimProbeContext context) { $business }
    public static string BusinessId(ContosoApimProbeContext context) { $businessId }
    public static bool Authorization(ContosoApimProbeContext context) { $authorization }
    public static bool Delegated(ContosoApimProbeContext context) { $delegated }
    public static bool Issuer(ContosoApimProbeContext context) { $issuer }
}
"@ | Out-Null

$results = foreach ($vector in $inputDocument.vectors) {
    $context = [ContosoApimProbeContext]::new()
    foreach ($key in $vector.headers.Keys) {
        $entries = [string[]] @($vector.headers[$key])
        if ($context.Request.Headers.ContainsKey($key)) {
            $entries = [string[]] @($context.Request.Headers[$key] + $entries)
        }
        $context.Request.Headers[$key] = $entries
    }
    $jwt = [Jwt]::new()
    if ($vector.Contains('claims')) {
        foreach ($key in $vector.claims.Keys) {
            $jwt.Claims[$key] = if ($null -eq $vector.claims[$key]) { $null } else { [string[]] @($vector.claims[$key]) }
        }
    }
    $context.Variables['contoso.validatedCallerJwt'] = $jwt
    $context.Variables['contoso.callerDelegated'] = [ContosoApimPolicyProbe]::Delegated($context)
    $context.Variables['contoso.callerTrustedInvocationIssuer'] = [ContosoApimPolicyProbe]::Issuer($context)
    $context.Variables['contoso.traceparentDisposition'] = [ContosoApimPolicyProbe]::Parent($context)
    $context.Variables['contoso.tracestateValid'] = [ContosoApimPolicyProbe]::State($context)
    $context.Variables['contoso.businessDisposition'] = [ContosoApimPolicyProbe]::Business($context)
    $context.Variables['contoso.businessId'] = [ContosoApimPolicyProbe]::BusinessId($context)
    $deleted = @()
    if ([ContosoApimPolicyProbe]::DeleteParent($context)) {
        $deleted = @('traceparent', 'tracestate')
    }
    elseif ([ContosoApimPolicyProbe]::DeleteState($context)) { $deleted = @('tracestate') }
    @{
        caseId = $vector.caseId
        parentDisposition = $context.Variables['contoso.traceparentDisposition']
        stateValid = $context.Variables['contoso.tracestateValid']
        deletedHeaders = $deleted
        businessDisposition = $context.Variables['contoso.businessDisposition']
        businessId = $context.Variables['contoso.businessId']
        delegated = $context.Variables['contoso.callerDelegated']
        trustedIssuer = $context.Variables['contoso.callerTrustedInvocationIssuer']
        authorizationHeaderValid = [ContosoApimPolicyProbe]::Authorization($context)
    }
}
@{
    sourceKind = 'local-clr-policy-expression'
    apimRuntimeVerified = $false
    jwtSignaturesVerified = $false
    parsedFragmentCount = $documents.Count
    results = @($results)
} | ConvertTo-Json -Depth 8 -Compress
