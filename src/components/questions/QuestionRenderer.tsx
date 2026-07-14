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
        <Text style={type.caption}>
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
  return (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder || 'Type your answer…'}
      placeholderTextColor={colors.inkFaint}
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
  return (
    <TextInput
      style={styles.singleInput}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder || 'Your answer…'}
      placeholderTextColor={colors.inkFaint}
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
  const plain = body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1');
  return (
    <View style={styles.contextBox}>
      {plain
        .split(/\n{2,}/)
        .filter((p) => p.trim().length > 0)
        .map((paragraph, i) => (
          <Text key={i} style={[type.body, i > 0 && { marginTop: spacing.sm }]}>
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
  const steps = [];
  for (let i = min; i <= max; i++) steps.push(i);
  // Emoji style maps 1:1 onto a 5-step scale; anything else falls back to
  // numbers rather than inventing intermediate faces.
  const useEmoji = !!emoji && steps.length === SCALE_EMOJIS.length;
  return (
    <View>
      <View style={styles.scaleRow}>
        {steps.map((s, i) => (
          <Pressable
            key={s}
            onPress={() => onChange(s)}
            style={[styles.scaleItem, value === s && styles.scaleItemActive]}
          >
            <Text style={[styles.scaleText, !useEmoji && value === s && styles.scaleTextActive]}>
              {useEmoji ? SCALE_EMOJIS[i] : s}
            </Text>
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
            style={[styles.choice, selected && styles.choiceActive]}
          >
            <View style={[styles.radio, selected && styles.radioActive, multiSelect && styles.checkbox]}>
              {selected ? <View style={[styles.radioDot, multiSelect && styles.checkboxDot]} /> : null}
            </View>
            <Text style={[type.h3, { flex: 1, fontWeight: '500' }]}>{opt}</Text>
          </Pressable>
        );
      })}
      {allowOther ? (
        <>
          <Pressable
            onPress={toggleOther}
            style={[styles.choice, otherSelected && styles.choiceActive]}
          >
            <View style={[styles.radio, otherSelected && styles.radioActive, multiSelect && styles.checkbox]}>
              {otherSelected ? <View style={[styles.radioDot, multiSelect && styles.checkboxDot]} /> : null}
            </View>
            <Text style={[type.h3, { flex: 1, fontWeight: '500' }]}>Other</Text>
          </Pressable>
          {otherSelected ? (
            <TextInput
              style={styles.singleInput}
              value={otherText}
              onChangeText={(t) => {
                setOtherText(t);
                commit(multiSelect ? optionValues : [], true, t);
              }}
              placeholder="Tell us more…"
              placeholderTextColor={colors.inkFaint}
              autoFocus
            />
          ) : null}
        </>
      ) : null}
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
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    fontSize: 16,
    color: colors.ink,
  },
  singleInput: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  contextBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
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
