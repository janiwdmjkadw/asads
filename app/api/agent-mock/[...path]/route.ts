import { NextResponse } from 'next/server';

import * as chats from '../../../../sandbox/agentChats';

/**
 * The scripted agent, served locally.
 *
 * `NEXT_PUBLIC_AGENT_CHAT_MOCK=true` points the chat transport at
 * `/api/agent-mock`, and nothing was serving it — so the window opened
 * on a spinner that never resolved and the conversation list never
 * arrived. The generic `/api/[...path]` catch-all cannot stand in for
 * it: these responses have shapes (`{conversations}`, `{messages}`,
 * `{run_id, stream_url}`) and one of them is an event stream.
 *
 * It speaks the same four calls the real transport does:
 *
 *   GET  /conversations                     → the list
 *   POST /conversations                     → start one
 *   GET  /conversations/:id/messages        → the thread
 *   POST /conversations/:id/messages        → admit a turn, hand back a run
 *   GET  /runs/:id/stream                   → that run, as SSE
 *   POST /runs/:id/cancel                   → stop it
 *
 * The run stream is the interesting one: it emits the same frames the
 * real one does — `run_status`, `generation_started`, a series of
 * `part_delta`s, `part_state`, `generation_committed`, then a terminal
 * `run_status` — so the streaming choreography (the gap row, the caret,
 * the settle) is exercised rather than mocked away.
 */

export const dynamic = 'force-dynamic';

/** Runs admitted this process. Cleared whenever the dev server restarts. */
const RUNS = new Map<string, { conversationId: string; reply: string }>();

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

function summary(c: chats.MockConversation) {
  return { id: c.id, title: c.title, created_at: c.created_at };
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const path = (await ctx.params).path ?? [];

  if (path.length === 1 && path[0] === 'conversations') {
    return json({ conversations: chats.conversations().map(summary), next_cursor: null });
  }

  if (path.length === 3 && path[0] === 'conversations' && path[2] === 'messages') {
    const conv = chats.conversation(decodeURIComponent(path[1]!));
    if (conv === undefined) return json({ code: 'not_found' }, 404);
    return json({ messages: conv.turns });
  }

  if (path.length === 3 && path[0] === 'runs' && path[2] === 'stream') {
    return streamRun(decodeURIComponent(path[1]!), request);
  }

  return json({ code: 'not_found' }, 404);
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const path = (await ctx.params).path ?? [];

  if (path.length === 1 && path[0] === 'conversations') {
    const body = (await request.json().catch(() => ({}))) as { title?: string };
    const made = chats.createConversation(typeof body.title === 'string' ? body.title : null);
    return json(summary(made), 201);
  }

  if (path.length === 3 && path[0] === 'conversations' && path[2] === 'messages') {
    const conv = chats.conversation(decodeURIComponent(path[1]!));
    if (conv === undefined) return json({ code: 'not_found' }, 404);
    const body = (await request.json().catch(() => ({}))) as { text?: string };
    const said = typeof body.text === 'string' ? body.text : '';
    const turn = chats.appendUserTurn(conv, said);
    const runId = `run_${Date.now().toString(36)}`;
    RUNS.set(runId, { conversationId: conv.id, reply: chats.scriptedReply(said) });
    return json(
      {
        message_id: turn.id,
        run_id: runId,
        stream_url: `/api/agent-mock/runs/${runId}/stream`,
      },
      202,
    );
  }

  if (path.length === 3 && path[0] === 'runs' && path[2] === 'cancel') {
    RUNS.delete(decodeURIComponent(path[1]!));
    return new Response(null, { status: 204 });
  }

  return json({ code: 'not_found' }, 404);
}

/**
 * One run, as the client expects to read it.
 *
 * The reply is emitted in word groups rather than all at once, because
 * the point of having it here is to watch the thing stream: the caret,
 * the gap row and the settle only exist while parts are arriving.
 */
function streamRun(runId: string, request: Request): Response {
  const run = RUNS.get(runId);
  const encoder = new TextEncoder();
  let seq = 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (kind: string, payload: unknown): void => {
        seq += 1;
        controller.enqueue(
          encoder.encode(`id: ${seq}\nevent: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`),
        );
      };
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

      if (run === undefined) {
        /* A run this process never admitted — a page reload mid turn, or
           a stream opened after a restart. The real surface answers the
           same way rather than hanging. */
        send('run_status', { status: 'completed', reason: 'unknown_run' });
        controller.close();
        return;
      }

      const generationId = `gen_${runId}`;
      const partId = `${runId}_p0`;

      send('run_status', { status: 'running' });
      send('generation_started', { generation_id: generationId, attempt_id: `att_${runId}`, epoch: 1 });

      /* A beat before the first word: the wait is a real part of this
         surface and the gap row is drawn for it. */
      await wait(420);

      const words = run.reply.split(/(\s+)/);
      let buffer = '';
      for (let i = 0; i < words.length; i += 3) {
        if (request.signal.aborted) break;
        const chunk = words.slice(i, i + 3).join('');
        buffer += chunk;
        send('part_delta', {
          generation_id: generationId,
          part_id: partId,
          ptype: 'text',
          delta: chunk,
        });
        await wait(38);
      }

      send('part_state', {
        generation_id: generationId,
        part_id: partId,
        part: { v: 1, type: 'text', text: buffer },
      });
      send('generation_committed', { generation_id: generationId });

      const conv = chats.conversation(run.conversationId);
      if (conv !== undefined) chats.appendAssistantTurn(conv, buffer, runId);

      send('run_status', { status: 'completed' });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
