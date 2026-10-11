/** Per-request secretary context. Contains no native engine configuration. */
export interface MishuSourceContext {instructions:string;endpoint?:string;token?:string}
export interface MishuSourceCapabilities {
 coordination:'supported'|'unavailable';
 reports:'supported'|'unavailable';
 reportOutputRecovery?:'supported'|'unavailable';
 reason?:string;
}
// Product instructions are owned by the independent MISHU package.
export {secretaryInstructions} from 'pi-coffee-mishu/host-policy';
