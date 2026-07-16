import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	allImageIds,
	collectGarbage,
	deleteSnapshot,
	getImage,
	getImages,
	getSnapshot,
	hashDataUrl,
	listSnapshots,
	pruneSnapshots,
	putImage,
	putSnapshot,
	registerImageRefs,
	runGc,
	totalImageBytes
} from './imageStore.js';

/** A provider whose backing array the tests swap out — registered once, since registration is permanent. */
let gcRefs: string[] = [];
let providerThrows = false;
registerImageRefs(() => {
	if (providerThrows) throw new Error('provider boom');
	return gcRefs;
});

async function clearAll(): Promise<void> {
	await collectGarbage([]);
	for (const snapshot of await listSnapshots()) await deleteSnapshot(snapshot.id);
	gcRefs = [];
	providerThrows = false;
}

beforeEach(clearAll);

describe('hashDataUrl', () => {
	it('is deterministic and content-addressed', async () => {
		const a = await hashDataUrl('data:one');
		const b = await hashDataUrl('data:one');
		const c = await hashDataUrl('data:two');
		expect(a).toBe(b);
		expect(a).not.toBe(c);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('putImage / getImage', () => {
	it('stores an image under its content hash and reads it back', async () => {
		const id = await putImage('data:image/png;base64,AAAA');
		expect(id).toBe(await hashDataUrl('data:image/png;base64,AAAA'));
		expect(await getImage(id)).toBe('data:image/png;base64,AAAA');
	});

	it('stores identical bytes exactly once (dedupe)', async () => {
		const first = await putImage('data:same');
		const second = await putImage('data:same');
		expect(first).toBe(second);
		expect(await allImageIds()).toEqual([first]);
	});

	it('returns null for an unknown id', async () => {
		expect(await getImage('nope')).toBeNull();
	});

	it('batch-fetches many images, skipping missing ids', async () => {
		const a = await putImage('data:a');
		const b = await putImage('data:b');
		const images = await getImages([a, b, 'missing']);
		expect(images.get(a)).toBe('data:a');
		expect(images.get(b)).toBe('data:b');
		expect(images.has('missing')).toBe(false);
	});

	it('reports the total stored byte size', async () => {
		await putImage('data:1234');
		expect(await totalImageBytes()).toBe('data:1234'.length);
	});
});

describe('collectGarbage', () => {
	it('deletes unreferenced blobs and keeps referenced ones', async () => {
		const keep = await putImage('data:keep');
		await putImage('data:drop');
		const removed = await collectGarbage([keep]);
		expect(removed).toBe(1);
		expect(await allImageIds()).toEqual([keep]);
	});
});

describe('runGc', () => {
	it('keeps blobs referenced by a registered provider and by a snapshot', async () => {
		const referenced = await putImage('data:referenced');
		const inSnapshot = await putImage('data:snapshot');
		const orphan = await putImage('data:orphan');
		gcRefs = [referenced];
		await putSnapshot({
			createdAt: 1,
			reason: 'auto',
			label: 's',
			data: {},
			imageIds: [inSnapshot]
		});

		const removed = await runGc();

		expect(removed).toBe(1);
		const remaining = (await allImageIds()).sort();
		expect(remaining).toEqual([referenced, inSnapshot].sort());
		expect(remaining).not.toContain(orphan);
	});

	it('over-collects nothing when a provider throws', async () => {
		await putImage('data:safe');
		providerThrows = true;
		const removed = await runGc();
		expect(removed).toBe(0);
		expect(await allImageIds()).toHaveLength(1);
	});
});

describe('snapshots', () => {
	it('stores, lists newest-first, and fetches a snapshot with its payload', async () => {
		await putSnapshot({
			createdAt: 100,
			reason: 'auto',
			label: 'old',
			data: { n: 1 },
			imageIds: []
		});
		await putSnapshot({
			createdAt: 200,
			reason: 'pre-import',
			label: 'new',
			data: { n: 2 },
			imageIds: []
		});

		const list = await listSnapshots();
		expect(list.map((s) => s.label)).toEqual(['new', 'old']);

		const full = await getSnapshot(list[0].id);
		expect(full?.data).toEqual({ n: 2 });
	});

	it('prunes to the newest N', async () => {
		for (let i = 0; i < 5; i++)
			await putSnapshot({ createdAt: i, reason: 'auto', label: `s${i}`, data: {}, imageIds: [] });

		await pruneSnapshots(3);

		const list = await listSnapshots();
		expect(list.map((s) => s.label)).toEqual(['s4', 's3', 's2']);
	});
});
