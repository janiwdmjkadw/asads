import { redirect } from 'next/navigation';

/*
 * `/pages` — an alias for `/sandbox`.
 *
 * Both links have been handed out. Rather than keep two copies of the
 * index in step, this one forwards, so there is only ever one page to
 * maintain and neither link ever 404s.
 */
export default function PagesRoute() {
  redirect('/sandbox');
}
