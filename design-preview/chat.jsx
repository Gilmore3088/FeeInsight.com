import {useState,useCallback} from 'react';
import {analysis,answerMarkdown} from './fixture.js';
export function useChat(options){const [messages,setMessages]=useState([]);const [status,setStatus]=useState('ready');
 const sendMessage=useCallback(async()=>{setStatus('submitted');const message={parts:[{type:'text',text:answerMarkdown}],metadata:{savedAnalysisId:'preview-analysis',hamiltonIdentity:analysis.identityContext}};setMessages([message]);await options.onFinish?.({message,isError:false,isAbort:false});setStatus('ready');},[options]);
 const stop=useCallback(()=>setStatus('ready'),[]);const clearError=useCallback(()=>{},[]);return {messages,setMessages,status,sendMessage,stop,clearError,error:undefined};}
