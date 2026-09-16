/**
 * The only tutorial data a client component is allowed to hold.
 *
 * The manifest lists every lesson, released or held, and the publish gate is a
 * runtime filter over that array — so importing it from a client module ships
 * unreleased titles and excerpts to the browser regardless of the gate. Server
 * components read the manifest, project the gated lessons down to this shape,
 * and pass it as a prop, so the bundle can only ever contain public lessons.
 */
export type LessonRef = {
  slug: string;
  title: string;
  series: string;
  part: number;
};
