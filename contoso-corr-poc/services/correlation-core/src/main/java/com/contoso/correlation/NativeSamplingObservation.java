package com.contoso.correlation;

import com.sun.tools.attach.VirtualMachine;
import javax.management.ObjectName;
import javax.management.remote.JMXConnectorFactory;
import javax.management.remote.JMXServiceURL;

public final class NativeSamplingObservation {
    private NativeSamplingObservation() {}

    public static void main(String[] arguments) {
        try {
            if (arguments.length != 1 || !arguments[0].matches("[1-9][0-9]{0,18}")) throw new IllegalArgumentException();
            String address;
            var machine = VirtualMachine.attach(arguments[0]);
            try { address = machine.startLocalManagementAgent(); }
            finally { machine.detach(); }
            try (var connection = JMXConnectorFactory.connect(new JMXServiceURL(address))) {
                String observed = (String) connection.getMBeanServerConnection()
                    .getAttribute(new ObjectName(SamplingRuntime.OBJECT_NAME), "ObservationJson");
                System.out.println(observed);
            }
        } catch (Exception failure) {
            System.err.println("NATIVE_RUNTIME_OBSERVER_UNAVAILABLE");
            System.exit(2);
        }
    }
}
