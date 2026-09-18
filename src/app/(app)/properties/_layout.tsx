import { Stack } from 'expo-router';

import { colors } from '@/theme';

/**
 * Nested stack for the Properties tab: list -> new-property form. Headers
 * are managed here (not by the parent Tabs layout — see the `properties`
 * tab's `headerShown: false` in `(app)/_layout.tsx`) so each screen gets
 * its own title without a duplicate header underneath it.
 */
export default function PropertiesStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Properties' }} />
      <Stack.Screen name="new" options={{ title: 'New Property', presentation: 'modal' }} />
      <Stack.Screen name="[id]/index" options={{ title: 'Property' }} />
      <Stack.Screen name="[id]/setup" options={{ title: 'Set Up Areas' }} />
      <Stack.Screen name="[id]/checklist" options={{ title: 'Checklist' }} />
      <Stack.Screen name="[id]/compliance" options={{ title: 'Compliance Documents' }} />
      <Stack.Screen name="[id]/compliance-tasks" options={{ title: 'Compliance Tasks' }} />
    </Stack>
  );
}
