import { Stack } from 'expo-router';

import { colors } from '@/theme';

/**
 * Nested stack for the Corrective Actions tab: board -> deficiency
 * detail. Same shape as properties/_layout.tsx and inspections/_layout.tsx
 * -- headers are managed here (not by the parent Tabs layout, see the
 * `corrective-actions` tab's `headerShown: false` in `(app)/_layout.tsx`).
 */
export default function CorrectiveActionsStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Corrective Actions' }} />
      <Stack.Screen name="[id]" options={{ title: 'Deficiency' }} />
    </Stack>
  );
}
