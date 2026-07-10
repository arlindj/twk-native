import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing, type } from '../../theme';
import { QuestionBlock } from '../../types';

/**
 * Question blocks are configured in the web builder; the mobile app
 * only renders them. Maze-style: one clear question, large touch
 * targets, brand highlight on selection.
 */

export type AnswerValue = string | number | string[] | boolean;

export function QuestionRenderer({
  question,
  value,
  onChange,
}: {
  question: QuestionBlock;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
}) {
  switch (question.type) {
    case 'open_text':
      return <OpenText value={typeof value === 'string' ? value : ''} onChange={onChange} />;
    case 'opinion_scale':
      return (
        <OpinionScale
          min={question.scaleMin ?? 1}
          max={question.scaleMax ?? 5}
          minLabel={question.scaleMinLabel}
          maxLabel={question.scaleMaxLabel}
          value={typeof value === 'number' ? value : undefined}
          onChange={onChange}
        />
      );
    case 'multiple_choice':
      return (
        <MultipleChoice
          options={question.options ?? []}
          multiSelect={!!question.multiSelect}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
        />
      );
    case 'yes_no':
      return <YesNo value={typeof value === 'boolean' ? value : undefined} onChange={onChange} />;
  }
}

function OpenText({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChange}
      placeholder="Type your answer…"
      placeholderTextColor={colors.inkFaint}
      multiline
      textAlignVertical="top"
    />
  );
}

function OpinionScale({
  min,
  max,
  minLabel,
  maxLabel,
  value,
  onChange,
}: {
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
  value?: number;
  onChange: (v: number) => void;
}) {
  const steps = [];
  for (let i = min; i <= max; i++) steps.push(i);
  return (
    <View>
      <View style={styles.scaleRow}>
        {steps.map((s) => (
          <Pressable
            key={s}
            onPress={() => onChange(s)}
            style={[styles.scaleItem, value === s && styles.scaleItemActive]}
          >
            <Text style={[styles.scaleText, value === s && styles.scaleTextActive]}>{s}</Text>
          </Pressable>
        ))}
      </View>
      {(minLabel || maxLabel) && (
        <View style={styles.scaleLabels}>
          <Text style={type.caption}>{minLabel ?? ''}</Text>
          <Text style={type.caption}>{maxLabel ?? ''}</Text>
        </View>
      )}
    </View>
  );
}

function MultipleChoice({
  options,
  multiSelect,
  value,
  onChange,
}: {
  options: string[];
  multiSelect: boolean;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (opt: string) => {
    if (multiSelect) {
      onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
    } else {
      onChange([opt]);
    }
  };
  return (
    <View style={{ gap: spacing.sm }}>
      {options.map((opt) => {
        const selected = value.includes(opt);
        return (
          <Pressable
            key={opt}
            onPress={() => toggle(opt)}
            style={[styles.choice, selected && styles.choiceActive]}
          >
            <View style={[styles.radio, selected && styles.radioActive, multiSelect && styles.checkbox]}>
              {selected ? <View style={[styles.radioDot, multiSelect && styles.checkboxDot]} /> : null}
            </View>
            <Text style={[type.h3, { flex: 1, fontWeight: '500' }]}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function YesNo({ value, onChange }: { value?: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {[
        { label: 'Yes', v: true },
        { label: 'No', v: false },
      ].map(({ label, v }) => (
        <Pressable
          key={label}
          onPress={() => onChange(v)}
          style={[styles.choice, { flex: 1, justifyContent: 'center' }, value === v && styles.choiceActive]}
        >
          <Text style={[type.h3, value === v && { color: colors.brandDark }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function isAnswered(question: QuestionBlock, value: AnswerValue | undefined): boolean {
  if (value === undefined) return false;
  if (question.type === 'open_text') return typeof value === 'string' && value.trim().length > 0;
  if (question.type === 'multiple_choice') return Array.isArray(value) && value.length > 0;
  return true;
}

const styles = StyleSheet.create({
  input: {
    minHeight: 120,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    fontSize: 16,
    color: colors.ink,
  },
  scaleRow: { flexDirection: 'row', gap: spacing.xs },
  scaleItem: {
    flex: 1,
    aspectRatio: 0.9,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleItemActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  scaleText: { fontSize: 16, fontWeight: '600', color: colors.ink },
  scaleTextActive: { color: '#fff' },
  scaleLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    padding: spacing.md,
  },
  choiceActive: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.inkFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.brand },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  checkbox: { borderRadius: 6 },
  checkboxDot: { borderRadius: 2 },
});
