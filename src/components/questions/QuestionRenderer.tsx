import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { inputChrome, radius, spacing, type, useTheme } from '../../theme';
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
  // Called unconditionally (Rules of Hooks) — question.type can change across
  // renders of this same component instance as the participant advances.
  const { colors } = useTheme();
  switch (question.type) {
    case 'open_text':
    case 'open_question': // synth's name for the same block
      return (
        <OpenText
          value={typeof value === 'string' ? value : ''}
          placeholder={question.placeholder}
          onChange={onChange}
        />
      );
    case 'simple_input':
      return (
        <SimpleInput
          value={typeof value === 'string' ? value : ''}
          inputType={question.inputType ?? 'text'}
          placeholder={question.placeholder}
          onChange={onChange}
        />
      );
    case 'context_screen':
      return <ContextScreen body={question.bodyMarkdown ?? question.description ?? ''} />;
    case 'opinion_scale':
      return (
        <OpinionScale
          min={question.scaleMin ?? 1}
          max={question.scaleMax ?? 5}
          minLabel={question.scaleMinLabel}
          maxLabel={question.scaleMaxLabel}
          emoji={question.scaleStyle === 'emoji'}
          value={typeof value === 'number' ? value : undefined}
          onChange={onChange}
        />
      );
    case 'multiple_choice':
      return (
        <MultipleChoice
          options={question.options ?? []}
          multiSelect={!!question.multiSelect}
          allowOther={!!question.allowOther}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
        />
      );
    case 'yes_no':
      return <YesNo value={typeof value === 'boolean' ? value : undefined} onChange={onChange} />;
    default:
      // A newer web builder can ship question types this app version does
      // not know. Render an explainer instead of a blank screen, and let
      // isAnswered() treat it as answered so the participant is never stuck.
      return (
        <Text style={[type.caption, { color: colors.ink3 }]}>
          This question isn’t supported by this app version — tap Next to continue.
        </Text>
      );
  }
}

const KNOWN_TYPES: QuestionBlock['type'][] = [
  'open_text',
  'open_question',
  'opinion_scale',
  'multiple_choice',
  'yes_no',
  'context_screen',
  'simple_input',
];

function OpenText({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const { colors, resolvedMode } = useTheme();
  return (
    <TextInput
      style={[styles.input, inputChrome(colors, resolvedMode)]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder || 'Type your answer…'}
      placeholderTextColor={colors.ink3}
      multiline
      textAlignVertical="top"
    />
  );
}

const KEYBOARD_BY_INPUT_TYPE = {
  text: 'default',
  email: 'email-address',
  phone: 'phone-pad',
  number: 'numeric',
} as const;

function SimpleInput({
  value,
  inputType,
  placeholder,
  onChange,
}: {
  value: string;
  inputType: 'text' | 'email' | 'phone' | 'number';
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const { colors, resolvedMode } = useTheme();
  return (
    <TextInput
      style={[styles.singleInput, inputChrome(colors, resolvedMode)]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder || 'Your answer…'}
      placeholderTextColor={colors.ink3}
      keyboardType={KEYBOARD_BY_INPUT_TYPE[inputType]}
      autoCapitalize={inputType === 'email' ? 'none' : 'sentences'}
      autoCorrect={inputType === 'text'}
    />
  );
}

/**
 * Informational block — no answer to collect. The builder authors the body
 * as markdown; the app renders it as plain paragraphs (bold/heading markers
 * stripped) rather than shipping a markdown engine for one block type.
 */
function ContextScreen({ body }: { body: string }) {
  const { colors } = useTheme();
  const plain = body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1');
  return (
    <View style={[styles.contextBox, { backgroundColor: colors.surface50, borderColor: colors.line }]}>
      {plain
        .split(/\n{2,}/)
        .filter((p) => p.trim().length > 0)
        .map((paragraph, i) => (
          <Text
            key={i}
            style={[type.body, { color: colors.ink3 }, i > 0 && { marginTop: spacing.sm }]}
          >
            {paragraph.trim()}
          </Text>
        ))}
    </View>
  );
}

const SCALE_EMOJIS = ['😞', '😕', '😐', '🙂', '😍'];

function OpinionScale({
  min,
  max,
  minLabel,
  maxLabel,
  emoji,
  value,
  onChange,
}: {
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
  emoji?: boolean;
  value?: number;
  onChange: (v: number) => void;
}) {
  const { colors } = useTheme();
  const steps = [];
  for (let i = min; i <= max; i++) steps.push(i);
  // Emoji style maps 1:1 onto a 5-step scale; anything else falls back to
  // numbers rather than inventing intermediate faces.
  const useEmoji = !!emoji && steps.length === SCALE_EMOJIS.length;
  return (
    <View>
      <View style={styles.scaleRow}>
        {steps.map((s, i) => {
          const active = value === s;
          return (
            <Pressable
              key={s}
              onPress={() => onChange(s)}
              style={[
                styles.scaleItem,
                { borderColor: colors.line, backgroundColor: colors.card },
                active && { backgroundColor: colors.brand, borderColor: colors.brand },
              ]}
            >
              <Text
                style={[
                  styles.scaleText,
                  { color: colors.ink },
                  !useEmoji && active && { color: colors.onBrand },
                ]}
              >
                {useEmoji ? SCALE_EMOJIS[i] : s}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {(minLabel || maxLabel) && (
        <View style={styles.scaleLabels}>
          <Text style={[type.caption, { color: colors.ink3 }]}>{minLabel ?? ''}</Text>
          <Text style={[type.caption, { color: colors.ink3 }]}>{maxLabel ?? ''}</Text>
        </View>
      )}
    </View>
  );
}

function MultipleChoice({
  options,
  multiSelect,
  allowOther,
  value,
  onChange,
}: {
  options: string[];
  multiSelect: boolean;
  allowOther: boolean;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const { colors, resolvedMode } = useTheme();
  // The answer array mixes picked options with an optional free-text
  // "Other" entry (any value that isn't one of the options). The typed
  // text only enters the array once non-empty, so an empty Other never
  // counts as answered.
  const [otherSelected, setOtherSelected] = useState(false);
  const [otherText, setOtherText] = useState('');
  const optionValues = value.filter((v) => options.includes(v));

  const commit = (opts: string[], other: boolean, text: string) => {
    const trimmed = text.trim();
    onChange(other && trimmed ? [...opts, trimmed] : opts);
  };

  const toggle = (opt: string) => {
    if (multiSelect) {
      const next = optionValues.includes(opt)
        ? optionValues.filter((v) => v !== opt)
        : [...optionValues, opt];
      commit(next, otherSelected, otherText);
    } else {
      setOtherSelected(false);
      onChange([opt]);
    }
  };

  const toggleOther = () => {
    const next = !otherSelected;
    setOtherSelected(next);
    commit(next && multiSelect ? optionValues : [], next, otherText);
  };

  return (
    <View style={{ gap: spacing.sm }}>
      {options.map((opt) => {
        const selected = optionValues.includes(opt);
        return (
          <Pressable
            key={opt}
            onPress={() => toggle(opt)}
            style={[
              styles.choice,
              { backgroundColor: colors.card, borderColor: colors.line },
              selected && { borderColor: colors.brand, backgroundColor: colors.brand50 },
            ]}
          >
            <View
              style={[
                styles.radio,
                { borderColor: colors.ink4 },
                selected && { borderColor: colors.brand },
                multiSelect && styles.checkbox,
              ]}
            >
              {selected ? (
                <View
                  style={[
                    styles.radioDot,
                    { backgroundColor: colors.brand },
                    multiSelect && styles.checkboxDot,
                  ]}
                />
              ) : null}
            </View>
            <Text style={[type.h3, { color: colors.ink, flex: 1, fontWeight: '500' }]}>{opt}</Text>
          </Pressable>
        );
      })}
      {allowOther ? (
        <>
          <Pressable
            onPress={toggleOther}
            style={[
              styles.choice,
              { backgroundColor: colors.card, borderColor: colors.line },
              otherSelected && { borderColor: colors.brand, backgroundColor: colors.brand50 },
            ]}
          >
            <View
              style={[
                styles.radio,
                { borderColor: colors.ink4 },
                otherSelected && { borderColor: colors.brand },
                multiSelect && styles.checkbox,
              ]}
            >
              {otherSelected ? (
                <View
                  style={[
                    styles.radioDot,
                    { backgroundColor: colors.brand },
                    multiSelect && styles.checkboxDot,
                  ]}
                />
              ) : null}
            </View>
            <Text style={[type.h3, { color: colors.ink, flex: 1, fontWeight: '500' }]}>Other</Text>
          </Pressable>
          {otherSelected ? (
            <TextInput
              style={[styles.singleInput, inputChrome(colors, resolvedMode)]}
              value={otherText}
              onChangeText={(t) => {
                setOtherText(t);
                commit(multiSelect ? optionValues : [], true, t);
              }}
              placeholder="Tell us more…"
              placeholderTextColor={colors.ink3}
              autoFocus
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function YesNo({ value, onChange }: { value?: boolean; onChange: (v: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {[
        { label: 'Yes', v: true },
        { label: 'No', v: false },
      ].map(({ label, v }) => {
        const selected = value === v;
        return (
          <Pressable
            key={label}
            onPress={() => onChange(v)}
            style={[
              styles.choice,
              { flex: 1, justifyContent: 'center', backgroundColor: colors.card, borderColor: colors.line },
              selected && { borderColor: colors.brand, backgroundColor: colors.brand50 },
            ]}
          >
            <Text style={[type.h3, { color: selected ? colors.brand700 : colors.ink }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function isAnswered(question: QuestionBlock, value: AnswerValue | undefined): boolean {
  // Unknown question types render as unanswerable info text — never gate on them.
  if (!KNOWN_TYPES.includes(question.type)) return true;
  // Informational block — there is nothing to answer.
  if (question.type === 'context_screen') return true;
  if (value === undefined) return false;
  if (question.type === 'open_text' || question.type === 'open_question' || question.type === 'simple_input') {
    return typeof value === 'string' && value.trim().length > 0;
  }
  if (question.type === 'multiple_choice') return Array.isArray(value) && value.length > 0;
  return true;
}

const styles = StyleSheet.create({
  input: {
    minHeight: 120,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
  },
  singleInput: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
  },
  contextBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  scaleRow: { flexDirection: 'row', gap: spacing.xs },
  scaleItem: {
    flex: 1,
    aspectRatio: 0.9,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleText: { fontSize: 16, fontWeight: '600' },
  scaleLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    padding: spacing.md,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  checkbox: { borderRadius: 6 },
  checkboxDot: { borderRadius: 2 },
});
