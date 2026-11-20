export type AnswerFileReference = {path:string; label:string; image:boolean};
export function answerFileReferences(text:string, options?:{from?:number;to?:number;budget?:number}):AnswerFileReference[];
