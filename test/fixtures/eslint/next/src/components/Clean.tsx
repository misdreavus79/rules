import { Text } from '@mantine/core';
import { AppLink } from '@/ui/AppLink';

export function Clean({ label }: { label: string }): React.ReactElement {
  return (
    <Text c="gray.7" size="md">
      <AppLink href="/carrito">{label}</AppLink>
    </Text>
  );
}
