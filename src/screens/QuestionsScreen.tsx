import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AnswerValue, isAnswered, QuestionRenderer } from '../components/questions/QuestionRenderer';
import { Button, ProgressBar, SectionLabel } from '../components/ui';
import { sessionElapsedMs } from '../events/eventQueue';
import { useSession } from '../state/sessionStore';
import { spacing, type, useTheme } from '../theme';
import { AnswerPayload } from '../types';

/**
 * Question blocks — one question per screen (Maze pattern). Values are
 * collected locally, then submitted as a batch for the checkpoint.
 */
export function QuestionsScreen() {
  const { colors } = useTheme();
  const bootstrap = useSession((s) => s.bootstrap);
  const questions = useSession((s) => s.pendingQuestions);
  const submitAnswers = useSession((s) => s.submitAnswers);
  const currentTaskIndex = useSession((s) => s.currentTaskIndex);

  const [index, setIndex] = useState(0);
  const [values, setValues] = useState<Record<string, AnswerValue>>({});
  const [busy, setBusy] = useState(false);

  if (!bootstrap || questions.length === 0) return null;
  const q = questions[index];
  const value = values[q.id];
  const canContinue = !q.required || isAnswered(q, value);
  const isLast = index === questions.length - 1;

  const next = async () => {
    if (isLast) {
      setBusy(true);
      const payloads: AnswerPayload[] = questions
        .filter((question) => values[question.id] !== undefined)
        .map((question) => ({
          questionId: question.id,
          taskId: question.afterTaskId ?? undefined,
          type: question.type,
          value:
            question.type === 'multiple_choice' && !question.multiSelect
              ? (values[question.id] as string[])[0]
              : values[question.id],
          answeredAtMs: sessionElapsedMs(),
        }));
      try {
        await submitAnswers(payloads);
      } finally {
        // Task-question submits advance to the next checkpoint while this
        // screen stays mounted; clear the busy flag so the button is usable.
        setBusy(false);
      }
    } else {
      setIndex(index + 1);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}>
          <ProgressBar progress={(index + 1) / (questions.length + 1)} />
          <View style={{ marginTop: spacing.lg }}>
            <SectionLabel>
              {q.afterTaskId
                ? `Question ${index + 1} of ${questions.length}`
                : `Final questions · ${index + 1}/${questions.length}`}
            </SectionLabel>
          </View>
          <Text style={[type.h1, { color: colors.ink }]}>{q.title}</Text>
          {q.description ? (
            <Text style={[type.body, { color: colors.ink3, marginTop: spacing.xs }]}>
              {q.description}
            </Text>
          ) : null}
          {q.type !== 'context_screen' ? (
            <Text style={[type.caption, { color: colors.ink4, marginVertical: spacing.sm }]}>
              {q.required ? 'Required' : 'Optional'}
            </Text>
          ) : (
            <View style={{ height: spacing.sm }} />
          )}
          <QuestionRenderer
            question={q}
            value={value}
            onChange={(v) => setValues((prev) => ({ ...prev, [q.id]: v }))}
          />
        </ScrollView>
        <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
          <Button
            label={isLast ? 'Submit answers' : 'Next'}
            onPress={next}
            disabled={!canContinue}
            loading={busy}
          />
          {!q.required && !isAnswered(q, value) ? (
            <Button label="Skip" variant="ghost" onPress={next} />
          ) : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
