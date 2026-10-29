import Link from 'next/link';
import { Button } from '@mantine/core';

export function Cta(): React.ReactElement {
  return <Button component={Link} href="/carrito">Ver carrito</Button>;
}
