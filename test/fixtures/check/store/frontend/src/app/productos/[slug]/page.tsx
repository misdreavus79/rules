import { Suspense } from 'react';

// An inline Suspense inside a page sits below the existence check: allowed.
export default function Producto() {
  return <Suspense fallback={null}>{null}</Suspense>;
}
