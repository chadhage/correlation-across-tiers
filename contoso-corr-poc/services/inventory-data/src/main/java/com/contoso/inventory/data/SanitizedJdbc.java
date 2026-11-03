package com.contoso.inventory.data;

import com.contoso.correlation.data.DataErrors;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.CallableStatement;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

final class SanitizedJdbc {
    private SanitizedJdbc() {}

    static Connection wrap(Connection connection) {
        return (Connection) wrapObject(connection, Connection.class, null);
    }

    private static Object wrapObject(Object delegate, Class<?> type, Connection parent) {
        return Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, (proxy, method, args) -> {
            String name = method.getName();
            if (name.equals("toString")) return "ContosoSanitizedJdbc";
            if (name.equals("getWarnings")) return null;
            if (name.equals("getConnection") && parent != null) return parent;
            if (name.equals("unwrap")) {
                if (((Class<?>) args[0]).isInstance(proxy)) return proxy;
                throw new SQLException("data_unwrap_forbidden");
            }
            if (name.equals("isWrapperFor")) return ((Class<?>) args[0]).isInstance(proxy);
            try {
                Object value = method.invoke(delegate, args);
                Connection owner = type == Connection.class ? (Connection) proxy : parent;
                if (value instanceof CallableStatement) return wrapObject(value, CallableStatement.class, owner);
                if (value instanceof PreparedStatement) return wrapObject(value, PreparedStatement.class, owner);
                if (value instanceof Statement) return wrapObject(value, Statement.class, owner);
                if (value instanceof ResultSet) return wrapObject(value, ResultSet.class, owner);
                return value;
            } catch (InvocationTargetException failure) {
                Throwable cause = failure.getCause();
                if (cause instanceof SQLException sql) throw DataErrors.sanitized(sql);
                throw cause;
            }
        });
    }
}
