import Image from '../opengraph-image';

export const revalidate = 3600;

/**
 * The Lukka Index picture at a stable address, for the page's "Télécharger
 * l'image" link: the metadata route beside it is served under a hashed path
 * that changes with each build.
 */
export async function GET() {
  const image = await Image();
  const body = await image.arrayBuffer();
  return new Response(body, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="indice-lukka.png"',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
