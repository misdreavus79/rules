import { Drawer, Grid } from '@mantine/core';

export function Layout(): React.ReactElement {
  return (
    <>
      <Grid gutter="md" />
      <Grid gap="md" />
      <Drawer.Root opened onClose={() => undefined} />
    </>
  );
}
