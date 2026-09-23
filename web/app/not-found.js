import { Wordmark } from '@/components/Brand';
import NotFoundView from '@/components/NotFoundView';

/**
 * A URL no route matches. This renders inside the bare root layout, outside
 * the site's header, so it carries the wordmark itself — otherwise a
 * mistyped link showed nothing that said it was Lukka Place.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="border-b border-line px-4 py-4 sm:px-6 lg:px-8">
        <Wordmark />
      </div>
      <NotFoundView />
    </div>
  );
}
