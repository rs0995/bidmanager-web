import React from 'react';
import { TriangleAlert } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { EmptyState } from './EmptyState';

type Props = {
  title?: string;
  description?: string;
  onRetry?: () => void;
};

export function ErrorState({
  title = 'Something went wrong',
  description = 'Check your connection and try again.',
  onRetry,
}: Props) {
  const t = useTheme();
  return (
    <EmptyState
      icon={<TriangleAlert size={24} color={t.colors.crit} />}
      title={title}
      description={description}
      actionLabel={onRetry ? 'Try again' : undefined}
      onAction={onRetry}
    />
  );
}
