import { describe, it, expect } from 'vitest';
import { tutorialTopics, tutorialReaderId, filterTutorials } from './tutorial-catalog.mjs';
import { readReleasedTutorialSeries, readTutorials } from './tutorials-data.mjs';
import { publishedTutorials, RELEASED_TUTORIAL_SERIES } from '../../app/tutorials/manifest';
import { readFileSync } from 'node:fs';

const list = [
  { title: 'Embeddings', excerpt: 'Python vectors', series: 'RAG', tags: ['Tutorial', 'AI', 'RAG', 'Python'] },
  { title: 'LoRA', excerpt: 'Train adapters', series: 'Tuning', tags: ['Tutorial', 'Python', 'Fine-Tuning'] },
  { title: 'Draft', excerpt: 'Private', series: 'RAG', tags: ['Tutorial', 'Secret'], draft: true },
];
describe('tutorial catalog', () => {
  it('uses identical published topic slugs/counts in the app and generator', () => {
    expect(tutorialTopics(readTutorials().filter((t) => t.published))).toEqual(tutorialTopics(publishedTutorials));
    expect(tutorialTopics(list)).toEqual([
      { tag: 'Python', slug: 'python', count: 2 },
      { tag: 'Fine-Tuning', slug: 'fine-tuning', count: 1 },
      { tag: 'RAG', slug: 'rag', count: 1 },
    ]);
  });
  it('keeps unreleased courses behind the explicit series gate', () => {
    const series = 'Become a Full-Stack AI Engineer';
    const generated = readTutorials();
    expect(readReleasedTutorialSeries()).toEqual([...RELEASED_TUTORIAL_SERIES]);
    expect(RELEASED_TUTORIAL_SERIES).not.toContain(series);
    expect(generated.filter((t) => t.series === series)).not.toHaveLength(0);
    expect(generated.filter((t) => t.series === series).every((t) => !t.published)).toBe(true);
    expect(publishedTutorials.some((t) => t.series === series)).toBe(false);
  });
  it('holds each lesson of an unreleased course behind its own release flag', () => {
    // The brake that matters: adding a course to RELEASED_TUTORIAL_SERIES must not
    // publish the whole course in a single edit. Once the series gate opens, the only
    // thing left is each lesson's own flag — so every held lesson must carry one.
    const series = 'Become a Full-Stack AI Engineer';
    const lessons = readTutorials().filter((t) => t.series === series);
    expect(lessons).not.toHaveLength(0);
    const wouldGoLiveOnRelease = lessons.filter((t) => !t.draft).map((t) => t.slug);
    expect(wouldGoLiveOnRelease).toEqual([]);
  });
  it('makes every lesson declare its own draft status explicitly', () => {
    // An omitted flag must never mean "publishable". The manifest's TypeScript type
    // requires it, and this pins the .mjs parser — which has no type checking — to
    // the same rule, so the app and the build scripts cannot drift apart.
    const undeclared = readTutorials().filter((t) => !t.draftDeclared).map((t) => t.slug);
    expect(undeclared).toEqual([]);
  });
  it('combines OR topics with search and course scope, excluding drafts', () => {
    expect(filterTutorials(list, { topics: ['RAG', 'Fine-Tuning'], query: 'python vectors' })).toEqual([list[0]]);
    expect(filterTutorials(list, { series: 'Tuning', query: 'lora' })).toEqual([list[1]]);
    expect(filterTutorials(list, { query: 'missing' })).toEqual([]);
  });
  it('keeps tutorial IDs unique, within the existing database constraint, and separate from blog IDs', () => {
    const blogIds = new Set(JSON.parse(readFileSync('public/blog/posts.json', 'utf8')).map((p) => p.id));
    const ids = readTutorials().map((t) => tutorialReaderId(t.slug));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9][a-z0-9-]{0,127}$/.test(id) && !blogIds.has(id))).toBe(true);
    expect(tutorialReaderId('vector-database-for-rag')).toBe('tutorial-vector-database-for-rag');
    expect(() => tutorialReaderId('../escape')).toThrow();
    expect(() => tutorialReaderId('x'.repeat(120))).toThrow();
  });
});
