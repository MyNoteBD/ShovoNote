import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "./supabase";
import App from "./App";
export type Profile = { user_id:string; organization_id:string; role:"owner"|"admin"|"viewer"|"staff"; employee_id:string|null; display_name:string|null };
export default function AuthGate(){
 const [session,setSession]=useState<any>(null),[profile,setProfile]=useState<Profile|null>(null),[loading,setLoading]=useState(true),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function load(s:any){
  setSession(s); if(!s){setProfile(null);setLoading(false);return;}
  let {data}=await supabase.from("profiles").select("*").eq("user_id",s.user.id).maybeSingle();
  if(!data){await supabase.rpc("bootstrap_attendance_owner"); const retry=await supabase.from("profiles").select("*").eq("user_id",s.user.id).maybeSingle();data=retry.data;}
  setProfile(data as Profile|null);setLoading(false);
 }
 useEffect(()=>{supabase.auth.getSession().then(({data})=>load(data.session));const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>{setLoading(true);void load(s)});return()=>subscription.unsubscribe()},[]);
 async function signIn(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");const {error}=await supabase.auth.signInWithPassword({email,password});if(error)setError(error.message);setBusy(false)}
 if(loading)return <div className="auth-check-surface" aria-hidden="true"/>;
 if(!session)return <main className="login"><section className="login-card"><div className="brand-mark">EA</div><h1>Employee Attendance System</h1><p>আপনার অ্যাকাউন্টে সাইন ইন করুন</p><form onSubmit={signIn}><label>ইমেইল<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="username"/></label><label>পাসওয়ার্ড<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/></label>{error&&<div className="error">{error}</div>}<button className="primary wide" disabled={busy}>"Sign in"</button></form></section></main>;
 if(!profile)return <div className="center"><h2>এই অ্যাকাউন্টের জন্য প্রোফাইল পাওয়া যায়নি</h2><p>অ্যাডমিনের সঙ্গে যোগাযোগ করুন।</p><button onClick={()=>supabase.auth.signOut()}>Sign out</button></div>;
 return <App profile={profile}/>;
}