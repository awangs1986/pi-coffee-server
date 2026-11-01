export interface SpeechBoundary {available?():boolean;cancel():void;speak(text:string):Promise<unknown>;}
export function browserSpeech(options?:{synthesis?:SpeechSynthesis;Utterance?:typeof SpeechSynthesisUtterance}):SpeechBoundary;
export function createSpeechController(options:{request:(body:Record<string,unknown>)=>Promise<any>;context:()=>{user?:string|null};browserId:string;speech?:SpeechBoundary;onStatus?:(status:any)=>void;onError?:(error:unknown)=>void}):{poll():Promise<void>;cancel():void;close():void};
