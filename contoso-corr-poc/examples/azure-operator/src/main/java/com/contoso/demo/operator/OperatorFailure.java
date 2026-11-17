package com.contoso.demo.operator;

final class OperatorFailure extends RuntimeException {
    final int status;
    OperatorFailure(int status, String code) { super(code); this.status = status; }
    static OperatorFailure invalid() { return new OperatorFailure(400, "OPERATOR_INPUT_INVALID"); }
    static OperatorFailure conflict() { return new OperatorFailure(409, "OPERATOR_OWNERSHIP_CONFLICT"); }
}
