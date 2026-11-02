public final class PackagedFunctionProbe {
    public static void main(String[] args) throws Exception {
        Class<?> function = Class.forName(args[0]);
        Class<?> context = Class.forName("com.microsoft.azure.functions.ExecutionContext");
        Object instance = function.getConstructor().newInstance();
        function.getMethod("poll", String.class, context).invoke(instance, null, null);
    }
}
