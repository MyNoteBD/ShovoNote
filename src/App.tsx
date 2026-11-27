import { useEffect, useMemo, useState } from "react";
import type { ReactNode, FormEvent } from "react";
import { supabase } from "./supabase";
import type { Profile } from "./AuthGate";
import {
  LogOut, Users, CalendarDays, Download, RefreshCw, Phone, ChevronLeft,
  ChevronRight, Search, Printer, ClipboardList, Shield, HardDrive, Plus,
  Check, X, Pencil, Upload, FileDown, UserRound, CalendarCheck, Clock
} from "lucide-react";

type Employee = {
  id:string; employee_code:string; full_name:string; department:string|null;
  designation?:string|null; email?:string|null; phone:string|null;
  joining_date?:string|null; emergency_contact?:string|null; is_active:boolean;
};
type Attendance = { id?:string; employee_id:string; attendance_date:string; status:string; note?:string|null };
type Leave = {
  id:string; employee_id:string; leave_type:string; start_date:string; end_date:string;
  reason:string|null; status:string; created_at:string;
};
type Event = { id:string; event_date:string; event_type:string; title:string; notes:string|null };
type UserProfile = { user_id:string; organization_id:string; role:string; employee_id:string|null; display_name:string|null };
type BackupRow = { id:string; file_name:string; storage_path:string; file_size:number; created_at:string };

const STATUSES = ["P","A","C/L","O/L","S/L","H","L/O","W/O","H/L"];
const LABELS:Record<string,string> = {P:"উপস্থিত",A:"অনুপস্থিত","C/L":"ক্যাজুয়াল ছুটি","O/L":"অফিসিয়াল ছুটি","S/L":"অসুস্থতাজনিত ছুটি",H:"Holiday","L/O":"Lay Off","W/O":"সাপ্তাহিক বন্ধ","H/L":"অর্ধদিবস ছুটি"};
const MONTHS = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];
const WEEKDAYS = ["রবি","সোম","মঙ্গল","বুধ","বৃহঃ","শুক্র","শনি"];
const weekday = (date:string) => WEEKDAYS[new Date(date+"T00:00:00").getDay()];
const dateKey = (d:Date) => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const today = () => dateKey(new Date());
const sortEmployees = (rows:Employee[]) => [...rows].sort((a,b)=>{
  const x=Number(a.employee_code),y=Number(b.employee_code);
  const xv=!!a.employee_code&&Number.isFinite(x),yv=!!b.employee_code&&Number.isFinite(y);
  if(xv&&yv)return x-y;if(xv)return -1;if(yv)return 1;
  return (a.employee_code||"").localeCompare(b.employee_code||"");
});
function downloadBlob(data:BlobPart,name:string,type="application/octet-stream"){
  const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement("a");
  a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
}
function csvDownload(rows:unknown[][],name:string){
  const csv="\ufeff"+rows.map(r=>r.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\r\n");
  downloadBlob(csv,name,"text/csv;charset=utf-8");
}
function StatusSelect({value,onChange,disabled=false}:{value:string;onChange:(v:string)=>void;disabled?:boolean}){
  return <select className={"status "+(value?"st-"+value.replace("/","-"):"")} value={value} disabled={disabled}
    onChange={e=>onChange(e.target.value)}><option value="">—</option>{STATUSES.map(s=><option key={s} value={s}>{s} · {LABELS[s]}</option>)}</select>;
}
function Field({label,children}:{label:string;children:ReactNode}){
  return <label className="field"><span>{label}</span>{children}</label>;
}
export default function App({profile}:{profile:Profile}){
  const canManage=["owner","admin"].includes(profile.role);
  const canSeeAll=["owner","admin","viewer"].includes(profile.role);
  const [employees,setEmployees]=useState<Employee[]>([]);
  const [attendance,setAttendance]=useState<Attendance[]>([]);
  const [leaves,setLeaves]=useState<Leave[]>([]);
  const [events,setEvents]=useState<Event[]>([]);
  const [users,setUsers]=useState<UserProfile[]>([]);
  const [backups,setBackups]=useState<BackupRow[]>([]);
  const [tab,setTab]=useState("month");
  const [month,setMonth]=useState(new Date());
  const [busy,setBusy]=useState(false);
  const [search,setSearch]=useState("");
  const [notice,setNotice]=useState("");
  const [noticeError,setNoticeError]=useState(false);
  const [selectedDate,setSelectedDate]=useState(today());
  const [draftStatuses,setDraftStatuses]=useState<Record<string,string>>({});
  const [expandedCalendarEmployee,setExpandedCalendarEmployee]=useState<string|null>(null);
  const [bulkStatus,setBulkStatus]=useState("P");
  const [selectedEmployee,setSelectedEmployee]=useState(profile.employee_id||"");
  const [employeeForm,setEmployeeForm]=useState<Partial<Employee>>({});
  const [editingEmployee,setEditingEmployee]=useState<string|null>(null);
  const [showEmployeeForm,setShowEmployeeForm]=useState(false);
  const [leaveForm,setLeaveForm]=useState({leave_type:"C/L",start_date:today(),end_date:today(),reason:""});
  const [eventForm,setEventForm]=useState({event_date:today(),event_type:"HOLIDAY",title:"",notes:""});
  const [accessForm,setAccessForm]=useState({user_id:"",role:"staff",employee_id:"",display_name:""});
  const [includeInactive,setIncludeInactive]=useState(false);
  const year=month.getFullYear();
  const first=dateKey(new Date(year,month.getMonth(),1));
  const last=dateKey(new Date(year,month.getMonth()+1,0));
  const yearFirst=dateKey(new Date(year,0,1));
  const yearLast=dateKey(new Date(year,11,31));
  const visibleEmployees=useMemo(()=>employees.filter(e=>(includeInactive||e.is_active)&&
    (canSeeAll||e.id===profile.employee_id)),[employees,includeInactive,canSeeAll,profile.employee_id]);
  const filtered=useMemo(()=>visibleEmployees.filter(e=>(e.full_name+" "+e.employee_code+" "+(e.department||"")).toLowerCase().includes(search.toLowerCase())),[visibleEmployees,search]);
  const lookup=useMemo(()=>new Map(attendance.map(a=>[a.employee_id+"|"+a.attendance_date,a])),[attendance]);
  const employeeMap=useMemo(()=>new Map(employees.map(e=>[e.id,e])),[employees]);
  const selectedEmployeeRow=employeeMap.get(selectedEmployee);
  const days=Array.from({length:new Date(year,month.getMonth()+1,0).getDate()},(_,i)=>i+1);
  const years=Array.from({length:12},(_,i)=>i);

  function message(text:string,error=false){setNotice(text);setNoticeError(error);}
  async function load(){
    setBusy(true);setNotice("");
    const empQuery=supabase.from("employees").select("id,employee_code,full_name,department,designation,email,phone,joining_date,emergency_contact,is_active").order("employee_code");
    const {data:empData,error:empError}=await empQuery;
    if(empError)message("কর্মচারী তালিকা: "+empError.message,true);
    const sorted=sortEmployees((empData||[]) as Employee[]);setEmployees(sorted);
    if(!selectedEmployee&&sorted[0])setSelectedEmployee(profile.employee_id||sorted[0].id);
    const {data:att,error:attError}=await supabase.from("attendance").select("id,employee_id,attendance_date,status,note").gte("attendance_date",yearFirst).lte("attendance_date",yearLast);
    if(attError)message("হাজিরার তথ্য: "+attError.message,true);setAttendance((att||[]) as Attendance[]);
    const {data:leaveData,error:leaveError}=await supabase.from("leave_requests").select("id,employee_id,leave_type,start_date,end_date,reason,status,created_at").order("created_at",{ascending:false});
    if(leaveError)message("ছুটির তথ্য: "+leaveError.message,true);setLeaves((leaveData||[]) as Leave[]);
    const {data:eventData,error:eventError}=await supabase.from("calendar_events").select("id,event_date,event_type,title,notes").gte("event_date",yearFirst).lte("event_date",yearLast).order("event_date");
    if(eventError)message("ক্যালেন্ডার: "+eventError.message,true);setEvents((eventData||[]) as Event[]);
    if(canManage){
      const {data:userData}=await supabase.from("profiles").select("user_id,organization_id,role,employee_id,display_name").order("display_name");
      setUsers((userData||[]) as UserProfile[]);
      const {data:backupData}=await supabase.from("backup_files").select("id,file_name,storage_path,file_size,created_at").order("created_at",{ascending:false});
      setBackups((backupData||[]) as BackupRow[]);
    }
    setBusy(false);
  }
  useEffect(()=>{void load();},[year,month.getMonth(),profile.user_id]);
  async function setStatus(employeeId:string,date:string,status:string){
    if(!canManage)return;setBusy(true);
    const old=lookup.get(employeeId+"|"+date);
    let result;
    if(!status&&old?.id)result=await supabase.from("attendance").delete().eq("id",old.id);
    else if(old?.id)result=await supabase.from("attendance").update({status}).eq("id",old.id);
    else if(status)result=await supabase.from("attendance").upsert({organization_id:profile.organization_id,employee_id:employeeId,attendance_date:date,status,entered_by:profile.user_id},{onConflict:"employee_id,attendance_date"});
    if(result?.error)message(result.error.message,true);else{message("হাজিরা সংরক্ষণ হয়েছে");await load();}
    setBusy(false);
  }
  function stageStatus(employeeId:string,date:string,status:string){setDraftStatuses(prev=>({...prev,[employeeId+"|"+date]:status}));}
  async function saveStagedStatus(employeeId:string,date:string){
    const key=employeeId+"|"+date;const status=draftStatuses[key];
    if(status===undefined)return;
    await setStatus(employeeId,date,status);
    setDraftStatuses(prev=>{const next={...prev};delete next[key];return next;});
  }
  async function updateAll(status:string){
    if(!canManage)return;
    const label=LABELS[status]||status;
    if(!window.confirm(selectedDate+" তারিখে সকল সক্রিয় কর্মচারীকে "+status+" ("+label+") করবেন?"))return;
    setBusy(true);
    const rows=employees.filter(e=>e.is_active).map(e=>({organization_id:profile.organization_id,employee_id:e.id,attendance_date:selectedDate,status,entered_by:profile.user_id}));
    const {error}=await supabase.from("attendance").upsert(rows,{onConflict:"employee_id,attendance_date"});
    if(error)message(error.message,true);else message("নির্বাচিত দিনের সকল সক্রিয় কর্মচারী "+status+" করা হয়েছে");
    await load();setBusy(false);
  }
  function exportMonth(){
    const rows:unknown[][]=[["Control No","Employee","Department","Date","Status","Status Name"]];
    employees.filter(e=>e.is_active).forEach(e=>days.forEach(d=>{
      const date=dateKey(new Date(year,month.getMonth(),d));const status=lookup.get(e.id+"|"+date)?.status||"";
      rows.push([e.employee_code,e.full_name,e.department,date,status,LABELS[status]||""]);
    }));
    csvDownload(rows,"attendance-"+first.slice(0,7)+".csv");
  }
  function exportEmployees(){
    csvDownload([["Control No","Name","Department","Designation","Phone","Email","Joining Date","Active"],...employees.map(e=>[e.employee_code,e.full_name,e.department,e.designation,e.phone,e.email,e.joining_date,e.is_active?"Yes":"No"])],"employees.csv");
  }
  const totals=(id:string)=>STATUSES.map(s=>({s,n:attendance.filter(a=>a.employee_id===id&&a.status===s&&a.attendance_date>=yearFirst&&a.attendance_date<=yearLast).length}));
  const monthCount=(status:string)=>attendance.filter(a=>a.status===status&&a.attendance_date>=first&&a.attendance_date<=last).length;
  async function saveEmployee(e:FormEvent){
    e.preventDefault();if(!canManage)return;setBusy(true);
    const payload={organization_id:profile.organization_id,employee_code:employeeForm.employee_code||"",full_name:employeeForm.full_name||"",department:employeeForm.department||null,designation:employeeForm.designation||null,email:employeeForm.email||null,phone:employeeForm.phone||null,joining_date:employeeForm.joining_date||null,emergency_contact:employeeForm.emergency_contact||null,is_active:employeeForm.is_active!==false};
    const result=editingEmployee?await supabase.from("employees").update(payload).eq("id",editingEmployee):await supabase.from("employees").insert(payload);
    if(result.error)message(result.error.message,true);else{message("কর্মচারীর তথ্য সংরক্ষণ হয়েছে");setShowEmployeeForm(false);setEditingEmployee(null);setEmployeeForm({});await load();}
    setBusy(false);
  }
  function editEmployee(e:Employee){setEditingEmployee(e.id);setEmployeeForm({...e});setShowEmployeeForm(true);}
  async function submitLeave(e:React.FormEvent){
    e.preventDefault();const employeeId=canManage?selectedEmployee:profile.employee_id;
    if(!employeeId){message("কর্মচারী নির্বাচন করুন",true);return;}
    setBusy(true);
    const payload={organization_id:profile.organization_id,employee_id:employeeId,leave_type:leaveForm.leave_type,start_date:leaveForm.start_date,end_date:leaveForm.end_date,reason:leaveForm.reason||null,status:"pending"};
    const {error}=await supabase.from("leave_requests").insert(payload);
    if(error)message(error.message,true);else{message("ছুটির আবেদন জমা হয়েছে");setLeaveForm({leave_type:"C/L",start_date:today(),end_date:today(),reason:""});await load();}
    setBusy(false);
  }
  async function reviewLeave(id:string,status:string){
    if(!canManage)return;setBusy(true);
    const {error}=await supabase.from("leave_requests").update({status,reviewed_by:profile.user_id}).eq("id",id);
    if(error)message(error.message,true);else{
      if(status==="approved"){
        const item=leaves.find(l=>l.id===id);
        if(item){
          const rows:any[]=[];const cursor=new Date(item.start_date+"T00:00:00");const end=new Date(item.end_date+"T00:00:00");
          while(cursor<=end){rows.push({organization_id:profile.organization_id,employee_id:item.employee_id,attendance_date:dateKey(cursor),status:item.leave_type,entered_by:profile.user_id,note:"Approved leave"});cursor.setDate(cursor.getDate()+1);}
          if(rows.length){const applied=await supabase.from("attendance").upsert(rows,{onConflict:"employee_id,attendance_date"});if(applied.error)message("আবেদন অনুমোদিত, তবে হাজিরায় ছুটি বসেনি: "+applied.error.message,true);}
        }
      }
      message(status==="approved"?"ছুটির আবেদন অনুমোদিত":"ছুটির আবেদন প্রত্যাখ্যাত");await load();
    }
    setBusy(false);
  }
  async function saveEvent(e:React.FormEvent){
    e.preventDefault();if(!canManage)return;setBusy(true);
    const {error}=await supabase.from("calendar_events").insert({organization_id:profile.organization_id,event_date:eventForm.event_date,event_type:eventForm.event_type,title:eventForm.title,notes:eventForm.notes||null});
    if(error)message(error.message,true);else{
      if(eventForm.event_type==="HOLIDAY"||eventForm.event_type==="WEEKLY_OFF"){
        const status=eventForm.event_type==="HOLIDAY"?"H":"W/O";
        const rows=employees.filter(emp=>emp.is_active).map(emp=>({organization_id:profile.organization_id,employee_id:emp.id,attendance_date:eventForm.event_date,status,entered_by:profile.user_id}));
        const result=await supabase.from("attendance").upsert(rows,{onConflict:"employee_id,attendance_date"});
        if(result.error)message("ইভেন্ট সংরক্ষিত, তবে হাজিরা চিহ্নিত হয়নি: "+result.error.message,true);
      }
      message("ক্যালেন্ডার ইভেন্ট সংরক্ষণ হয়েছে");setEventForm({event_date:today(),event_type:"HOLIDAY",title:"",notes:""});await load();
    }setBusy(false);
  }
  async function deleteEvent(id:string){
    if(!canManage||!window.confirm("এই ক্যালেন্ডার ইভেন্ট মুছবেন?"))return;
    const {error}=await supabase.from("calendar_events").delete().eq("id",id);
    if(error)message(error.message,true);else{message("ইভেন্ট মুছে ফেলা হয়েছে");await load();}
  }
  async function saveAccess(e:React.FormEvent){
    e.preventDefault();if(!canManage)return;
    if(!accessForm.user_id.trim()){message("Supabase Auth User ID দিন",true);return;}
    setBusy(true);
    const payload={user_id:accessForm.user_id.trim(),organization_id:profile.organization_id,role:accessForm.role,employee_id:accessForm.role==="staff"?(accessForm.employee_id||null):null,display_name:accessForm.display_name||null};
    const {error}=await supabase.from("profiles").upsert(payload,{onConflict:"user_id"});
    if(error)message(error.message,true);else{message("অ্যাক্সেস প্রোফাইল সংরক্ষণ হয়েছে");setAccessForm({user_id:"",role:"staff",employee_id:"",display_name:""});await load();}
    setBusy(false);
  }
  async function removeAccess(userId:string){
    if(!canManage||userId===profile.user_id||!window.confirm("এই ব্যবহারকারীর অ্যাক্সেস প্রোফাইল মুছবেন?"))return;
    const {error}=await supabase.from("profiles").delete().eq("user_id",userId);
    if(error)message(error.message,true);else{message("অ্যাক্সেস সরানো হয়েছে");await load();}
  }
  async function makeBackup(){
    if(!canManage)return;setBusy(true);
    const payload={app:"Employee Attendance System",version:1,created_at:new Date().toISOString(),organization_id:profile.organization_id,employees,attendance,leave_requests:leaves,calendar_events:events};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const fileName="attendance-backup-"+today()+".json";
    const path=profile.organization_id+"/"+Date.now()+"-"+fileName;
    const {error:uploadError}=await supabase.storage.from("workledger-backups").upload(path,blob,{contentType:"application/json",upsert:false});
    if(uploadError){message(uploadError.message,true);setBusy(false);return;}
    const {error:metaError}=await supabase.from("backup_files").insert({organization_id:profile.organization_id,storage_path:path,file_name:fileName,content_type:"application/json",file_size:blob.size,uploaded_by:profile.user_id});
    if(metaError)message("ফাইল আপলোড হয়েছে, কিন্তু তালিকায় যোগ হয়নি: "+metaError.message,true);else message("ব্যাকআপ নিরাপদে সংরক্ষণ হয়েছে");
    await load();setBusy(false);
  }
  async function downloadBackup(path:string,name:string){
    const {data,error}=await supabase.storage.from("workledger-backups").download(path);
    if(error){message(error.message,true);return;}
    if(data){const url=URL.createObjectURL(data);const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
  }
  async function restoreBackup(file:File){
    if(!canManage)return;
    if(!window.confirm("ব্যাকআপের রেকর্ডগুলো বর্তমান তথ্যের সঙ্গে যুক্ত/আপডেট হবে। কোনো বর্তমান রেকর্ড মুছে ফেলা হবে না। চালাবেন?"))return;
    setBusy(true);
    try{
      const raw=JSON.parse(await file.text());
      if(raw.organization_id!==profile.organization_id)throw new Error("এই ব্যাকআপটি অন্য প্রতিষ্ঠানের।");
      const groups:[string,any[]][]=[["employees",raw.employees||[]],["attendance",raw.attendance||[]],["leave_requests",raw.leave_requests||[]],["calendar_events",raw.calendar_events||[]]];
      for(const [table,rows] of groups){
        if(!rows.length)continue;
        const safe=rows.map(row=>{const copy={...row};delete copy.created_at;return copy;});
        const {error}=await supabase.from(table).upsert(safe);
        if(error)throw new Error(table+": "+error.message);
      }
      message("ব্যাকআপের রেকর্ডগুলো পুনরুদ্ধার হয়েছে");await load();
    }catch(err){message(err instanceof Error?err.message:"ব্যাকআপ পড়া যায়নি",true);}
    setBusy(false);
  }
  async function deleteBackup(id:string,path:string){
    if(!canManage||!window.confirm("এই ব্যাকআপ ফাইল মুছবেন?"))return;
    const {error:storageError}=await supabase.storage.from("workledger-backups").remove([path]);
    if(storageError){message(storageError.message,true);return;}
    const {error}=await supabase.from("backup_files").delete().eq("id",id);
    if(error)message(error.message,true);else{message("ব্যাকআপ মুছে ফেলা হয়েছে");await load();}
  }

  const tabs=[
    ...(canSeeAll?[{id:"month",label:"মাসিক রেজিস্টার",icon:<CalendarDays/>},{id:"year",label:"বার্ষিক ক্যালেন্ডার",icon:<CalendarCheck/>},{id:"employees",label:"কর্মচারী",icon:<Users/>}]:[{id:"mine",label:"আমার হাজিরা",icon:<UserRound/>}]),
    {id:"leaves",label:"ছুটির আবেদন",icon:<ClipboardList/>},
    ...(canSeeAll?[{id:"calendar",label:"ছুটি ও হলিডে",icon:<CalendarDays/>}]:[]),
    ...(canManage?[{id:"access",label:"অ্যাক্সেস",icon:<Shield/>},{id:"backups",label:"ব্যাকআপ",icon:<HardDrive/>}]:[])
  ];
  const currentTitle=tabs.find(t=>t.id===tab)?.label||"Employee Attendance System";
  return <div className="shell">
    <main className="main">
      <header className="topbar"><div className="brand"><div className="brand-mark">SN</div><div><h1>ShovoNote</h1><p>{currentTitle} · {profile.display_name||"ব্যবহারকারী"} · {profile.role}</p></div></div><div className="actions"><button className="icon-btn" onClick={()=>void load()} title="Refresh"><RefreshCw/></button><button className="icon-btn" onClick={()=>window.print()} title="Print / PDF"><Printer/></button><button onClick={()=>supabase.auth.signOut()}><LogOut/> বের হন</button></div></header>
      <nav className="top-navigation">{tabs.map(t=><button key={t.id} className={tab===t.id?"active":""} onClick={()=>setTab(t.id)}>{t.icon}{t.label}</button>)}</nav>
      {notice&&<div className={noticeError?"notice error":"notice success"}>{notice}</div>}
      {tab!=="access"&&tab!=="backups"&&<section className="stats">
        <div><span>মোট কর্মচারী</span><strong>{canSeeAll?employees.filter(e=>e.is_active).length:(profile.employee_id?1:0)}</strong></div>
        <div><span>এই মাসে উপস্থিতি</span><strong>{canSeeAll?monthCount("P"):attendance.filter(a=>a.employee_id===profile.employee_id&&a.status==="P"&&a.attendance_date>=first&&a.attendance_date<=last).length}</strong></div>
        <div><span>মুলতুবি ছুটির আবেদন</span><strong>{leaves.filter(l=>l.status==="pending"&&(canManage||l.employee_id===profile.employee_id)).length}</strong></div>
      </section>}

      {(tab==="month"||tab==="year")&&<div className="toolbar">
        <div className="month-nav"><button onClick={()=>setMonth(new Date(year,month.getMonth()-1,1))}><ChevronLeft/></button><b>{MONTHS[month.getMonth()]} {year}</b><button onClick={()=>setMonth(new Date(year,month.getMonth()+1,1))}><ChevronRight/></button></div>
        <div className="actions">{canManage&&tab==="month"&&<><Field label="এন্ট্রির তারিখ"><input type="date" value={selectedDate} onChange={e=>{setSelectedDate(e.target.value);const d=new Date(e.target.value+"T00:00:00");setMonth(new Date(d.getFullYear(),d.getMonth(),1));}}/><small className="weekday-hint">{weekday(selectedDate)}বার</small></Field><Field label="সবার জন্য স্ট্যাটাস"><select value={bulkStatus} onChange={e=>setBulkStatus(e.target.value)}>{STATUSES.map(s=><option key={s} value={s}>{s} · {LABELS[s]}</option>)}</select></Field><button className="primary bulk-action" onClick={()=>void updateAll(bulkStatus)} disabled={busy}>Update All Status</button></>}<button onClick={exportMonth}><Download/> CSV</button></div>
      </div>}
      {tab==="month"&&<div className="table-wrap"><table><thead><tr><th>Control No</th><th>কর্মচারীর নাম</th>{days.map(d=>{const date=dateKey(new Date(year,month.getMonth(),d));return <th key={d}><span className="weekday-head">{weekday(date)}</span><b>{d}</b></th>;})}<th>Present</th></tr></thead><tbody>
        {filtered.map(emp=><tr key={emp.id}><td>{emp.employee_code}</td><td className="name-cell">{emp.full_name}<small>{emp.department||""}</small></td>
          {days.map(d=>{const date=dateKey(new Date(year,month.getMonth(),d));const key=emp.id+"|"+date;const st=lookup.get(key)?.status||"";const isSelected=date===selectedDate;const draft=draftStatuses[key];return <td key={d} className={isSelected?"selected-date-cell":""}>{isSelected&&canManage?<div className="cell-editor"><StatusSelect value={draft===undefined?st:draft} disabled={busy} onChange={v=>stageStatus(emp.id,date,v)}/><button className="save-cell" disabled={busy||draft===undefined} onClick={()=>void saveStagedStatus(emp.id,date)}>{busy?"…":"Update"}</button></div>:<span className={"status-read "+(st?"day-"+st.replace("/","-"):"")}>{st||"—"}</span>}</td>;})}
          <td>{attendance.filter(a=>a.employee_id===emp.id&&a.status==="P"&&a.attendance_date>=first&&a.attendance_date<=last).length}</td></tr>)}
      </tbody></table></div>}
      {tab==="year"&&<><div className="calendar-year-picker"><label>ক্যালেন্ডার বছর <select value={year} onChange={e=>setMonth(new Date(Number(e.target.value),month.getMonth(),1))}>{Array.from({length:9},(_,i)=>new Date().getFullYear()-4+i).map(y=><option key={y} value={y}>{y}</option>)}</select></label><span className="muted">ক্যালেন্ডার দেখতে কর্মচারীর নাম চাপুন</span></div><div className="employee-list calendar-employee-list">{filtered.map(emp=><div className="calendar-employee" key={emp.id}><button className={"calendar-employee-toggle "+(expandedCalendarEmployee===emp.id?"expanded":"")} onClick={()=>setExpandedCalendarEmployee(prev=>prev===emp.id?null:emp.id)}><span><b>{emp.employee_code}</b><strong>{emp.full_name}</strong></span><span>{expandedCalendarEmployee===emp.id?"Hide calendar":"View calendar"} <span className="toggle-mark">{expandedCalendarEmployee===emp.id?"−":"＋"}</span></span></button>{expandedCalendarEmployee===emp.id&&<article className="employee-year calendar-expanded"><div className="months">{years.map(i=>{const count=new Date(year,i+1,0).getDate();const offset=new Date(year,i,1).getDay();return <div className="mini-month" key={i}><b>{MONTHS[i]}</b><div className="days"><span className="weekday-label">রবি</span><span className="weekday-label">সোম</span><span className="weekday-label">মঙ্গল</span><span className="weekday-label">বুধ</span><span className="weekday-label">বৃহঃ</span><span className="weekday-label">শুক্র</span><span className="weekday-label">শনি</span>{Array.from({length:offset},(_,n)=><span key={"blank"+n}/>)}{Array.from({length:count},(_,d)=>{const date=dateKey(new Date(year,i,d+1));const st=lookup.get(emp.id+"|"+date)?.status||"";return <span title={date+" "+(LABELS[st]||"")} className={st?"day-"+st.replace("/","-"):""} key={d}>{st&&st!=="P"?st:d+1}</span>;})}</div></div>;})}</div><div className="totals">{totals(emp.id).map(t=><span key={t.s}>{t.s}: <b>{t.n}</b></span>)}</div></article>}</div>)}</div></>}
      {tab==="mine"&&<><div className="toolbar"><div className="month-nav"><button onClick={()=>setMonth(new Date(year,month.getMonth()-1,1))}><ChevronLeft/></button><b>{MONTHS[month.getMonth()]} {year}</b><button onClick={()=>setMonth(new Date(year,month.getMonth()+1,1))}><ChevronRight/></button></div></div><div className="employee-year"><h3>{selectedEmployeeRow?.full_name||profile.display_name||"আমার হাজিরা"} · {selectedEmployeeRow?.employee_code||""}</h3><div className="months">{years.map(i=><div className="mini-month" key={i}><b>{MONTHS[i]}</b><div className="days"><span className="weekday-label">রবি</span><span className="weekday-label">সোম</span><span className="weekday-label">মঙ্গল</span><span className="weekday-label">বুধ</span><span className="weekday-label">বৃহঃ</span><span className="weekday-label">শুক্র</span><span className="weekday-label">শনি</span>{Array.from({length:new Date(year,i+1,0).getDate()},(_,d)=>{const date=dateKey(new Date(year,i,d+1));const st=lookup.get((profile.employee_id||"")+"|"+date)?.status||"";return <span key={d} title={date+" "+(LABELS[st]||"")} className={st?"day-"+st.replace("/","-"):""}>{st&&st!=="P"?st:d+1}</span>;})}</div></div>)}</div><div className="totals">{totals(profile.employee_id||"").map(t=><span key={t.s}>{t.s}: <b>{t.n}</b></span>)}</div></div><h3>আমার ছুটির রেকর্ড</h3><LeaveTable leaves={leaves.filter(l=>l.employee_id===profile.employee_id)} employeeMap={employeeMap}/></>}
      {tab==="employees"&&<><div className="toolbar"><div className="search"><Search/><input placeholder="নাম বা Control Number দিয়ে খুঁজুন" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="actions"><label className="checkline"><input type="checkbox" checked={includeInactive} onChange={e=>setIncludeInactive(e.target.checked)}/> নিষ্ক্রিয়সহ</label><button onClick={exportEmployees}><Download/> CSV</button>{canManage&&<button className="primary" onClick={()=>{setEditingEmployee(null);setEmployeeForm({is_active:true});setShowEmployeeForm(true)}}><Plus/> নতুন কর্মচারী</button>}</div></div>
        <div className="employee-list">{filtered.map(emp=><div className="employee-row" key={emp.id}><div><b>{emp.employee_code} · {emp.full_name}</b><small>{emp.department||"—"} · {emp.designation||"—"} {emp.phone||""} {!emp.is_active?" · নিষ্ক্রিয়":""}</small></div><div className="actions">{emp.phone&&<a className="call" href={"tel:"+emp.phone}><Phone/> কল</a>}{canManage&&<button onClick={()=>editEmployee(emp)}><Pencil/> Edit</button>}</div></div>)}</div>
        {showEmployeeForm&&<div className="modal-backdrop"><form className="modal" onSubmit={saveEmployee}><div className="modal-head"><h2>{editingEmployee?"কর্মচারীর তথ্য সম্পাদনা":"নতুন কর্মচারী"}</h2><button type="button" onClick={()=>setShowEmployeeForm(false)}><X/></button></div><div className="form-grid">
          <Field label="Control Number"><input value={employeeForm.employee_code||""} onChange={e=>setEmployeeForm({...employeeForm,employee_code:e.target.value})}/></Field>
          <Field label="কর্মচারীর নাম *"><input required value={employeeForm.full_name||""} onChange={e=>setEmployeeForm({...employeeForm,full_name:e.target.value})}/></Field>
          <Field label="বিভাগ"><input value={employeeForm.department||""} onChange={e=>setEmployeeForm({...employeeForm,department:e.target.value})}/></Field>
          <Field label="পদবি"><input value={employeeForm.designation||""} onChange={e=>setEmployeeForm({...employeeForm,designation:e.target.value})}/></Field>
          <Field label="ফোন"><input value={employeeForm.phone||""} onChange={e=>setEmployeeForm({...employeeForm,phone:e.target.value})}/></Field>
          <Field label="ইমেইল"><input type="email" value={employeeForm.email||""} onChange={e=>setEmployeeForm({...employeeForm,email:e.target.value})}/></Field>
          <Field label="যোগদানের তারিখ"><input type="date" value={employeeForm.joining_date||""} onChange={e=>setEmployeeForm({...employeeForm,joining_date:e.target.value})}/></Field>
          <Field label="জরুরি যোগাযোগ"><input value={employeeForm.emergency_contact||""} onChange={e=>setEmployeeForm({...employeeForm,emergency_contact:e.target.value})}/></Field>
        </div><label className="checkline"><input type="checkbox" checked={employeeForm.is_active!==false} onChange={e=>setEmployeeForm({...employeeForm,is_active:e.target.checked})}/> সক্রিয় কর্মচারী</label><div className="modal-actions"><button type="button" onClick={()=>setShowEmployeeForm(false)}>বাতিল</button><button className="primary" disabled={busy}>সংরক্ষণ</button></div></form></div>}
      </>}
      {tab==="leaves"&&<><div className="panel"><h3>{canManage?"ছুটির আবেদন পর্যালোচনা":"ছুটির আবেদন জমা দিন"}</h3>{profile.role==="staff"&&<form onSubmit={submitLeave} className="form-grid"><Field label="ছুটির ধরন"><select value={leaveForm.leave_type} onChange={e=>setLeaveForm({...leaveForm,leave_type:e.target.value})}>{["C/L","O/L","S/L","H/L"].map(s=><option key={s} value={s}>{s} · {LABELS[s]}</option>)}</select></Field><Field label="শুরুর তারিখ"><input type="date" required value={leaveForm.start_date} onChange={e=>setLeaveForm({...leaveForm,start_date:e.target.value})}/></Field><Field label="শেষ তারিখ"><input type="date" required min={leaveForm.start_date} value={leaveForm.end_date} onChange={e=>setLeaveForm({...leaveForm,end_date:e.target.value})}/></Field><Field label="কারণ"><input value={leaveForm.reason} onChange={e=>setLeaveForm({...leaveForm,reason:e.target.value})}/></Field><button className="primary" disabled={busy}>আবেদন জমা দিন</button></form>}</div>
        <LeaveTable leaves={canSeeAll?leaves:leaves.filter(l=>l.employee_id===profile.employee_id)} employeeMap={employeeMap} canReview={canManage} onReview={reviewLeave}/></>}
      {tab==="calendar"&&<>{canManage&&<div className="panel"><h3>ছুটি / হলিডে / সাপ্তাহিক বন্ধ যোগ করুন</h3><form className="form-grid" onSubmit={saveEvent}><Field label="তারিখ"><input type="date" required value={eventForm.event_date} onChange={e=>setEventForm({...eventForm,event_date:e.target.value})}/></Field><Field label="ধরন"><select value={eventForm.event_type} onChange={e=>setEventForm({...eventForm,event_type:e.target.value})}><option value="HOLIDAY">Holiday / সরকারি ছুটি</option><option value="WEEKLY_OFF">Weekly Off / সাপ্তাহিক বন্ধ</option><option value="NOTICE">অন্যান্য নোটিশ</option></select></Field><Field label="শিরোনাম"><input required value={eventForm.title} onChange={e=>setEventForm({...eventForm,title:e.target.value})}/></Field><Field label="বিবরণ"><input value={eventForm.notes} onChange={e=>setEventForm({...eventForm,notes:e.target.value})}/></Field><button className="primary" disabled={busy}><Plus/> ইভেন্ট যোগ করুন</button></form><p className="muted">Holiday যোগ করলে সকল সক্রিয় কর্মচারীর হাজিরায় H এবং Weekly Off যোগ করলে W/O বসবে।</p></div>}<div className="employee-list">{events.map(ev=><div className="employee-row" key={ev.id}><div><b>{ev.event_date} · {ev.title}</b><small>{ev.event_type==="HOLIDAY"?"Holiday":ev.event_type==="WEEKLY_OFF"?"Weekly Off":"Notice"} · {ev.notes||""}</small></div>{canManage&&<button onClick={()=>void deleteEvent(ev.id)}><X/> মুছুন</button>}</div>)}</div></>}
      {tab==="access"&&canManage&&<><div className="panel"><h3>নতুন অ্যাক্সেস প্রোফাইল যুক্ত / আপডেট</h3><p className="muted">ব্যবহারকারীকে আগে Supabase Auth-এ অ্যাকাউন্ট তৈরি করতে হবে। এরপর তার Auth User ID এখানে দিয়ে কর্মচারী ও ভূমিকা নির্ধারণ করুন।</p><form className="form-grid" onSubmit={saveAccess}><Field label="Supabase Auth User ID"><input required value={accessForm.user_id} onChange={e=>setAccessForm({...accessForm,user_id:e.target.value})} placeholder="UUID"/></Field><Field label="নাম"><input value={accessForm.display_name} onChange={e=>setAccessForm({...accessForm,display_name:e.target.value})}/></Field><Field label="Role"><select value={accessForm.role} onChange={e=>setAccessForm({...accessForm,role:e.target.value})}><option value="staff">Staff · নিজের তথ্য</option><option value="viewer">Viewer · শুধু দেখা</option><option value="admin">Admin · পরিচালনা</option></select></Field><Field label="কর্মচারী (Staff হলে)"><select value={accessForm.employee_id} onChange={e=>setAccessForm({...accessForm,employee_id:e.target.value})}><option value="">নির্বাচন করুন</option>{employees.map(emp=><option key={emp.id} value={emp.id}>{emp.employee_code} · {emp.full_name}</option>)}</select></Field><button className="primary" disabled={busy}>অ্যাক্সেস সংরক্ষণ</button></form></div><div className="employee-list">{users.map(u=><div className="employee-row" key={u.user_id}><div><b>{u.display_name||u.user_id}</b><small>{u.role} · {employeeMap.get(u.employee_id||"")?.full_name||"কোনো কর্মচারী যুক্ত নেই"} · {u.user_id}</small></div><div className="actions">{u.user_id!==profile.user_id&&u.role!=="owner"&&<button onClick={()=>void removeAccess(u.user_id)}><X/> Remove</button>}{u.user_id!==profile.user_id&&u.role!=="owner"&&<button onClick={()=>setAccessForm({user_id:u.user_id,role:u.role,employee_id:u.employee_id||"",display_name:u.display_name||""})}><Pencil/> Edit</button>}</div></div>)}</div></>}
      {tab==="backups"&&canManage&&<><div className="panel"><h3>ডেটাবেস ব্যাকআপ</h3><p className="muted">কর্মচারী, হাজিরা, ছুটির আবেদন ও ক্যালেন্ডার ইভেন্টের JSON ব্যাকআপ নিরাপদ Private Storage-এ সংরক্ষিত হবে।</p><div className="actions"><button className="primary" disabled={busy} onClick={()=>void makeBackup()}><HardDrive/> এখনই ব্যাকআপ নিন</button><label className="upload-btn"><Upload/> ব্যাকআপ Restore করুন<input type="file" accept=".json,application/json" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void restoreBackup(f);e.currentTarget.value="";}}/></label></div></div><div className="employee-list">{backups.map(b=><div className="employee-row" key={b.id}><div><b>{b.file_name}</b><small>{new Date(b.created_at).toLocaleString("bn-BD")} · {(b.file_size/1024).toFixed(1)} KB</small></div><div className="actions"><button onClick={()=>void downloadBackup(b.storage_path,b.file_name)}><FileDown/> Download</button><button onClick={()=>void deleteBackup(b.id,b.storage_path)}><X/> Delete</button></div></div>)}{!backups.length&&<p className="muted pad">এখনো কোনো ব্যাকআপ নেই।</p>}</div></>}
      <footer>Employee Attendance System · Secure access · {busy?"আপডেট হচ্ছে…":"সর্বশেষ তথ্য"}</footer>
    </main>
  </div>;
}
function LeaveTable({leaves,employeeMap,canReview=false,onReview}:{leaves:Leave[];employeeMap:Map<string,Employee>;canReview?:boolean;onReview?:(id:string,status:string)=>void}){
  if(!leaves.length)return <div className="panel muted">কোনো ছুটির রেকর্ড নেই।</div>;
  return <div className="employee-list">{leaves.map(l=><div className="employee-row leave-row" key={l.id}><div><b>{employeeMap.get(l.employee_id)?.full_name||"কর্মচারী"} · {l.leave_type}</b><small>{l.start_date} → {l.end_date} · {l.reason||"কারণ উল্লেখ নেই"} · <span className={"leave-status "+l.status}>{l.status==="pending"?"অপেক্ষমাণ":l.status==="approved"?"অনুমোদিত":"প্রত্যাখ্যাত"}</span></small></div>{canReview&&l.status==="pending"&&<div className="actions"><button className="approve" onClick={()=>onReview?.(l.id,"approved")}><Check/> Approve</button><button className="reject" onClick={()=>onReview?.(l.id,"rejected")}><X/> Reject</button></div>}</div>)}</div>;
}
