const MAX_ACTIVE_GLOBAL = 8;
const MAX_ACTIVE_PER_USER = 2;
const MAX_QUEUED_GLOBAL = 32;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

type QueueItem = {
  userId: string;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
};

type UsageWindow = {
  startedAt: number;
  count: number;
};

type PolicyState = {
  activeGlobal: number;
  activeByUser: Map<string, number>;
  queue: QueueItem[];
  usageByUser: Map<string, UsageWindow>;
};

export class AiRequestPolicyError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "AiRequestPolicyError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const globalState = globalThis as typeof globalThis & {
  __mightGuyAiPolicy?: PolicyState;
};

const state: PolicyState =
  globalState.__mightGuyAiPolicy ??
  (globalState.__mightGuyAiPolicy = {
    activeGlobal: 0,
    activeByUser: new Map(),
    queue: [],
    usageByUser: new Map(),
  });

function releaseSlot(userId: string): void {
  state.activeGlobal = Math.max(0, state.activeGlobal - 1);

  const activeForUser = (state.activeByUser.get(userId) ?? 1) - 1;
  if (activeForUser > 0) {
    state.activeByUser.set(userId, activeForUser);
  } else {
    state.activeByUser.delete(userId);
  }

  pumpQueue();
}

function canStart(userId: string): boolean {
  return (
    state.activeGlobal < MAX_ACTIVE_GLOBAL &&
    (state.activeByUser.get(userId) ?? 0) < MAX_ACTIVE_PER_USER
  );
}

function grantSlot(userId: string): () => void {
  state.activeGlobal += 1;
  state.activeByUser.set(userId, (state.activeByUser.get(userId) ?? 0) + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseSlot(userId);
  };
}

function pumpQueue(): void {
  let index = 0;

  while (index < state.queue.length && state.activeGlobal < MAX_ACTIVE_GLOBAL) {
    const item = state.queue[index];

    if (!canStart(item.userId)) {
      index += 1;
      continue;
    }

    state.queue.splice(index, 1);
    item.resolve(grantSlot(item.userId));
  }
}

export async function acquireAiRequestLease(userId: string): Promise<() => void> {
  const now = Date.now();
  const current = state.usageByUser.get(userId);
  const usage = !current || now - current.startedAt >= WINDOW_MS
    ? { startedAt: now, count: 1 }
    : { ...current, count: current.count + 1 };

  if (usage.count > MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.max(1, Math.ceil((WINDOW_MS - (now - usage.startedAt)) / 1000));
    throw new AiRequestPolicyError(
      "Your AI request limit was reached. Please wait before starting another task.",
      retryAfterSeconds,
    );
  }

  state.usageByUser.set(userId, usage);

  if (canStart(userId)) {
    return grantSlot(userId);
  }

  if (state.queue.length >= MAX_QUEUED_GLOBAL) {
    throw new AiRequestPolicyError(
      "The AI request queue is busy. Please try again shortly.",
      10,
    );
  }

  return new Promise((resolve, reject) => {
    state.queue.push({ userId, resolve, reject });
    pumpQueue();
  });
}
