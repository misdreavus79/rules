const geist = { variable: 'geist' };

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="es" className={geist.variable}>
      <body className={geist.variable}>{children}</body>
    </html>
  );
}
