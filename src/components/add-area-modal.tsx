import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { colors, radius, spacing, touchTarget, typography } from '@/theme';

export type AreaType = { id: string; name: string };

const APARTMENT_UNIT_TYPE_NAME = 'Apartment/Unit';
const MAX_BEDROOMS = 10;

type AddAreaModalProps = {
  visible: boolean;
  areaTypes: AreaType[];
  selectedAreaTypes: AreaType[];
  areaName: string;
  bedroomCount: number;
  onChangeBedroomCount: (count: number) => void;
  isSubmitting: boolean;
  error: string | null;
  onToggleAreaType: (areaType: AreaType) => void;
  onChangeAreaName: (name: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

/**
 * "Add area" step of the guided property setup wizard (Phase 4): pick any
 * number of the platform-standard area types to add at once (checkboxes,
 * not one-at-a-time). Each gets its own `property_locations` row, named
 * after its area type by default.
 *
 * When exactly one type is selected, a "Name this area" field appears so
 * that specific instance can be renamed (e.g. "Stairwell A" instead of
 * just "Stairwell") -- useful for properties with more than one of the
 * same area type. With multiple types selected, all are added using their
 * area type's name; add a second one at a time afterward to customize.
 *
 * Selecting "Apartment/Unit" by itself (Phase 12) swaps that field for a
 * "Unit name" + bedroom-count stepper instead: submitting creates
 * Bedroom 1..N plus a Kitchen, Bathroom, and Living Room in one go, all
 * under that unit's name. A closet, storage room, or mechanical room can
 * still be added afterward as its own area (those area types already
 * exist in the standard library).
 */
export function AddAreaModal({
  visible,
  areaTypes,
  selectedAreaTypes,
  areaName,
  bedroomCount,
  onChangeBedroomCount,
  isSubmitting,
  error,
  onToggleAreaType,
  onChangeAreaName,
  onCancel,
  onSubmit,
}: AddAreaModalProps) {
  const count = selectedAreaTypes.length;
  const isApartmentUnitMode = count === 1 && selectedAreaTypes[0].name === APARTMENT_UNIT_TYPE_NAME;
  const submitLabel = isApartmentUnitMode
    ? `Add unit (${bedroomCount + 3} rooms)`
    : count > 1
      ? `Add ${count} areas`
      : 'Add area';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={typography.sectionTitle}>Add areas</Text>
          <Text style={[typography.body, styles.hint]}>Select one or more area types to add.</Text>

          <ScrollView style={styles.areaTypeList} keyboardShouldPersistTaps="handled">
            {areaTypes.map((areaType) => {
              const isSelected = selectedAreaTypes.some((selected) => selected.id === areaType.id);
              return (
                <Pressable
                  key={areaType.id}
                  onPress={() => onToggleAreaType(areaType)}
                  style={({ pressed }) => [
                    styles.areaTypeRow,
                    isSelected && styles.areaTypeRowSelected,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                >
                  <Ionicons
                    name={isSelected ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={isSelected ? colors.slate : colors.textDisabled}
                  />
                  <Text
                    style={[
                      isSelected ? typography.bodyStrong : typography.body,
                      styles.areaTypeLabel,
                    ]}
                  >
                    {areaType.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {isApartmentUnitMode ? (
            <>
              <TextField
                label="Unit name"
                value={areaName}
                onChangeText={onChangeAreaName}
                placeholder="e.g. Unit 4B"
              />
              <View style={styles.stepperRow}>
                <Text style={typography.label}>Bedrooms</Text>
                <View style={styles.stepper}>
                  <Pressable
                    onPress={() => onChangeBedroomCount(Math.max(1, bedroomCount - 1))}
                    style={({ pressed }) => [styles.stepperButton, pressed && styles.rowPressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease bedroom count"
                  >
                    <Ionicons name="remove" size={20} color={colors.slate} />
                  </Pressable>
                  <Text style={[typography.bodyStrong, styles.stepperValue]}>{bedroomCount}</Text>
                  <Pressable
                    onPress={() => onChangeBedroomCount(Math.min(MAX_BEDROOMS, bedroomCount + 1))}
                    style={({ pressed }) => [styles.stepperButton, pressed && styles.rowPressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Increase bedroom count"
                  >
                    <Ionicons name="add" size={20} color={colors.slate} />
                  </Pressable>
                </View>
              </View>
              <Text style={[typography.caption, styles.hint]}>
                Creates Bedroom 1–{bedroomCount}, plus Kitchen, Bathroom, and Living Room. Add a
                closet, storage room, or mechanical room separately afterward if this unit has one.
              </Text>
            </>
          ) : count === 1 ? (
            <TextField label="Name this area" value={areaName} onChangeText={onChangeAreaName} />
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button label="Cancel" variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.actionButton}>
              <Button
                label={submitLabel}
                onPress={onSubmit}
                loading={isSubmitting}
                disabled={count === 0 || (count === 1 && !areaName.trim())}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    maxHeight: '85%',
  },
  hint: {
    color: colors.textSecondary,
    marginTop: -spacing.xs,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepperButton: {
    width: touchTarget.minHeight,
    height: touchTarget.minHeight,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    minWidth: 24,
    textAlign: 'center',
  },
  areaTypeList: {
    maxHeight: 320,
  },
  areaTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  areaTypeRowSelected: {
    backgroundColor: colors.background,
  },
  areaTypeLabel: {
    flex: 1,
  },
  rowPressed: {
    opacity: 0.6,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
  },
});
