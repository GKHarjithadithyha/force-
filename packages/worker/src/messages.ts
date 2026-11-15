import type {
  ChartBatch,
  ConnectionState,
  DeviceInfo,
  DeviceProfile,
  GapRecord,
  LiveSnapshot,
  RangeTotals,
  SessionSummary,
  SourceKind,
  StepEvent,
} from '@force/contracts';

/**
 * Typed message protocol between the main thread and the worker (Architecture section 10).
 * The worker and the screens never import each other; this is the whole interface.
 * Packet buffers are TRANSFERRED, not copied.
 */

/** Every history query and settings call, by name. Arguments and results are structured-cloneable. */
export interface RpcMethods {
  getProfile: { args: []; result: DeviceProfile };
  saveProfile: { args: [DeviceProfile]; result: void };
  listSessions: { args: []; result: SessionSummary[] };
  getSessionSeries: { args: [string, [number, number]?]; result: ChartBatch };
  getSessionSteps: { args: [string]; result: StepEvent[] };
  getSessionGaps: { args: [string]; result: GapRecord[] };
  exportCsv: { args: [string]; result: Blob };
  exportSessionJson: { args: [string]; result: Blob };
  exportStepsCsv: { args: [number, number]; result: Blob };
  getTotals: { args: [number, number]; result: RangeTotals };
  recomputeSession: {
    args: [string, DeviceProfile];
    result: SessionSummary;
  };
  renameSession: { args: [string, string]; result: void };
  deleteSession: { args: [string]; result: void };
  deleteAllData: { args: []; result: void };
  importSessionJson: { args: [string]; result: SessionSummary };
}
export type RpcMethod = keyof RpcMethods;

export type ToWorker =
  /** One raw 15-byte notification. `buf` is transferred. */
  | { type: 'packet'; buf: ArrayBuffer; arrivalMs: number }
  /** A stream begins (any previous session is closed first). */
  | { type: 'start'; source: SourceKind; deviceId: string; deviceInfo: DeviceInfo | null }
  /** The user stopped or disconnected: close the session. */
  | { type: 'stop' }
  /** The source's connection state changed (it owns the state machine, Architecture section 11). */
  | { type: 'link'; state: ConnectionState; detail?: string; atMs: number }
  | { type: 'rssi'; dbm: number | null }
  | {
      type: 'rpc';
      id: number;
      method: RpcMethod;
      args: unknown[];
    };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'snapshot'; snapshot: LiveSnapshot }
  | { type: 'chart'; batch: ChartBatch }
  | { type: 'step'; step: StepEvent }
  | { type: 'gap'; gap: GapRecord }
  | { type: 'rpcResult'; id: number; ok: true; value: unknown }
  | { type: 'rpcResult'; id: number; ok: false; error: string }
  /** The worker hit an unexpected error: the session was closed and stored data is intact. Restart it. */
  | { type: 'fatal'; message: string };

export type Post = (msg: FromWorker, transfer?: Transferable[]) => void;
