import Image from 'next/image';

export function Photo(): React.ReactElement {
  return <Image src="/a.png" alt="Foto" width={10} height={10} />;
}
