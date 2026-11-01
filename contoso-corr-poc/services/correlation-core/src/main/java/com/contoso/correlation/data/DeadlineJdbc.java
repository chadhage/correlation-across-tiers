package com.contoso.correlation.data;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.CallableStatement;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;

final class DeadlineJdbc {
    private DeadlineJdbc() {}

    static Connection wrap(Connection connection, OperationContext context) {
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(),
            new Class<?>[]{Connection.class}, (proxy, method, args) -> {
                if (method.getName().equals("toString")) return "ContosoDeadlineConnection";
                if (method.getName().equals("unwrap")) {
                    if (((Class<?>) args[0]).isInstance(proxy)) return proxy;
                    throw new SQLException("data_unwrap_forbidden");
                }
                if (method.getName().equals("isWrapperFor")) return ((Class<?>) args[0]).isInstance(proxy);
                if (!method.getName().equals("close") && !method.getName().equals("rollback") &&
                    !method.getName().equals("isClosed")) PgOperations.remainingMillis(context);
                try {
                    Object result = method.invoke(connection, args);
                    return result instanceof Statement statement
                        ? statement(statement, (Connection) proxy, context) : result;
                } catch (InvocationTargetException failure) { throw failure.getCause(); }
            });
    }

    private static Statement statement(Statement statement, Connection connection, OperationContext context) {
        Class<?> type = statement instanceof CallableStatement ? CallableStatement.class
            : statement instanceof PreparedStatement ? PreparedStatement.class : Statement.class;
        return (Statement) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type},
            (proxy, method, args) -> {
                String name = method.getName();
                if (name.equals("toString")) return "ContosoDeadlineStatement";
                if (name.equals("getConnection")) return connection;
                if (name.equals("unwrap")) {
                    if (((Class<?>) args[0]).isInstance(proxy)) return proxy;
                    throw new SQLException("data_unwrap_forbidden");
                }
                if (name.equals("isWrapperFor")) return ((Class<?>) args[0]).isInstance(proxy);
                if (name.startsWith("execute")) {
                    long millis = Math.min(2_000, PgOperations.remainingMillis(context));
                    statement.setQueryTimeout((int) Math.max(1, (millis + 999) / 1_000));
                }
                try { return method.invoke(statement, args); }
                catch (InvocationTargetException failure) { throw failure.getCause(); }
            });
    }
}
