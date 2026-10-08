import {afterEach,expect,it,vi} from 'vitest';
// @ts-expect-error Browser module has no declaration file.
import {createSocketHeartbeat} from '../public/socket-heartbeat.js';
afterEach(()=>vi.useRealTimers());
it('detects silence without letting repeated wake probes extend the deadline',()=>{
 vi.useFakeTimers();const sendPing=vi.fn((_nonce:string)=>true),onFailure=vi.fn();const h=createSocketHeartbeat({sendPing,onFailure});h.start();h.probe();vi.advanceTimersByTime(9000);h.probe();expect(sendPing).toHaveBeenCalledTimes(1);vi.advanceTimersByTime(1000);expect(onFailure).toHaveBeenCalledWith('pong_timeout');vi.advanceTimersByTime(60000);expect(sendPing).toHaveBeenCalledTimes(1);
});
it('accepts only the pending nonce, pauses while hidden, and rejects a stale resumed pong',()=>{
 vi.useFakeTimers();const sendPing=vi.fn((_nonce:string)=>true),onFailure=vi.fn();const h=createSocketHeartbeat({sendPing,onFailure});h.start();vi.advanceTimersByTime(15000);const stale=sendPing.mock.calls[0]?.[0];expect(h.pong('wrong')).toBe(false);h.stop();vi.advanceTimersByTime(60000);expect(onFailure).not.toHaveBeenCalled();h.start();h.probe();expect(h.pong(stale)).toBe(false);expect(h.pong(sendPing.mock.calls.at(-1)?.[0])).toBe(true);vi.advanceTimersByTime(10000);expect(onFailure).not.toHaveBeenCalled();h.stop();
});
