/* PdfLens engine - PDF structure inspector.
   Header version, indirect object scan, shallow dictionary parse, trailer
   (Root/Info/Encrypt/Size), page count via the page tree root, Info metadata
   (literal + hex strings, UTF-16BE + escapes). No deps.
   Browser global PdfLens, or module.exports in node. */
(function(root){
'use strict';
function toLatin1(bytes){
  var parts=[];
  for(var i=0;i<bytes.length;i+=8192)
    parts.push(String.fromCharCode.apply(null,bytes.subarray(i,i+8192)));
  return parts.join('');
}
function decodePdfString(raw){
  /* raw = inner bytes of a literal string, as latin1 string, escapes intact */
  var out='',i;
  for(i=0;i<raw.length;i++){
    var c=raw[i];
    if(c==='\\'&&i+1<raw.length){
      var n=raw[i+1];
      if(n==='n'){out+='\n';i++;continue;}
      if(n==='r'){out+='\r';i++;continue;}
      if(n==='t'){out+='\t';i++;continue;}
      if(n==='b'){out+='\b';i++;continue;}
      if(n==='f'){out+='\f';i++;continue;}
      if(n==='('||n===')'||n==='\\'){out+=n;i++;continue;}
      if(n==='\n'){i++;continue;}
      if(n==='\r'){i++;if(raw[i+1]==='\n')i++;continue;}
      if(n>='0'&&n<='7'){
        var oct='',j=0;
        while(j<3&&i+1<raw.length&&raw[i+1]>='0'&&raw[i+1]<='7'){oct+=raw[i+1];i++;j++;}
        out+=String.fromCharCode(parseInt(oct,8)&0xFF);continue;
      }
      out+=n;i++;continue;
    }
    out+=c;
  }
  if(out.length>=2&&out.charCodeAt(0)===0xFE&&out.charCodeAt(1)===0xFF){
    var u='';
    for(i=2;i+1<out.length;i+=2)u+=String.fromCharCode((out.charCodeAt(i)<<8)|out.charCodeAt(i+1));
    return u;
  }
  return out;
}
function decodeHexString(h){
  var s='';
  for(var i=0;i+1<h.length;i+=2)s+=String.fromCharCode(parseInt(h.substr(i,2),16));
  return decodePdfString(s);
}
/* shallow dictionary reader: returns {names:{Name:{kind,value,ref?}}} */
function parseDict(s,start){
  var i=start,names={};
  function ws(){while(i<s.length&&' \t\r\n\f\0'.indexOf(s[i])>=0)i++;
    if(s[i]==='%'){while(i<s.length&&s[i]!=='\n')i++;ws();}}
  function name(){var m=/^\/[^\s\[\]<>()/%]+/.exec(s.slice(i));if(!m)return null;i+=m[0].length;return m[0].slice(1);}
  function token(){
    ws();
    if(i>=s.length)return null;
    if(s[i]==='/'){var n=name();return n===null?null:{kind:'name',value:n};}
    if(s[i]==='('){
      var depth=1,j=i+1,raw='';
      while(j<s.length&&depth>0){
        var c=s[j];
        if(c==='\\'){raw+=c+s[j+1];j+=2;continue;}
        if(c==='(')depth++;
        if(c===')'){depth--;if(depth===0){j++;break;}}
        raw+=c;j++;
      }
      var str=raw;i=j;
      return {kind:'string',value:decodePdfString(str)};
    }
    if(s[i]==='<'){
      if(s[i+1]==='<'){i+=2;return {kind:'dict_open'};}
      var h='',k=i+1;
      while(k<s.length&&s[k]!=='>'){h+=s[k];k++;}
      i=k+1;
      return {kind:'string',value:decodeHexString(h.replace(/\s/g,''))};
    }
    if(s[i]==='['){
      var j2=i+1,d2=1;
      while(j2<s.length&&d2>0){if(s[j2]==='[')d2++;if(s[j2]===']')d2--;j2++;}
      var arr=s.slice(i,j2);i=j2;
      return {kind:'array',value:arr};
    }
    var m2=/^-?\d+\s+-?\d+\s+R/.exec(s.slice(i));
    if(m2){i+=m2[0].length;var p=m2[0].split(/\s+/);return {kind:'ref',value:parseInt(p[0],10),gen:parseInt(p[1],10)};}
    var m3=/^-?\d+(\.\d+)?/.exec(s.slice(i));
    if(m3){i+=m3[0].length;return {kind:'number',value:parseFloat(m3[0])};}
    var m4=/^(true|false|null)/.exec(s.slice(i));
    if(m4){i+=m4[0].length;return {kind:'keyword',value:m4[1]};}
    i++;return token();
  }
  ws();
  if(s[i]!=='<'||s[i+1]!=='<')return null;
  i+=2;
  while(i<s.length){
    ws();
    if(s[i]==='>'&&s[i+1]==='>')break;
    if(s[i]!=='/')break;
    var nm=name();
    var v=token();
    if(nm&&v)names[nm]=v;
    else if(!v)break;
  }
  return names;
}
function parse(bytes){
  var out={errors:[],warnings:[],objects:[]};
  out.size=bytes.length;
  var s=toLatin1(bytes);
  var hi=s.slice(0,1024).indexOf('%PDF-');
  if(hi<0){out.errors.push('no %PDF- header found');return out;}
  out.version=s.slice(hi+5,hi+8);
  out.has_eof=s.lastIndexOf('%%EOF')>=Math.max(0,s.length-1024);
  if(!out.has_eof)out.warnings.push('file appears truncated (no %%EOF marker)');
  /* indirect object scan */
  var re=/(\d+) (\d+) obj\b/g,m,seen={};
  while((m=re.exec(s))!==null){
    var num=parseInt(m[1],10),gen=parseInt(m[2],10);
    var bodyStart=m.index+m[0].length;
    var end=s.indexOf('endobj',bodyStart);
    var body=s.slice(bodyStart,end<0?Math.min(bodyStart+4000,s.length):end);
    var obj={num:num,gen:gen,offset:m.index};
    if(gen===0&&!seen[num]){seen[num]=1;}
    var d=parseDict(body,0);
    if(d){
      if(d.Type)obj.type=d.Type.value;
      if(d.Subtype)obj.subtype=d.Subtype.value;
      if(d.Count)obj.count=d.Count.value;
      if(d.Kids)obj.kids=d.Kids.value;
      if(d.Length)obj.length=d.Length.value;
      if(d.Root)obj.root_ref=d.Root.value;
      if(d.Info)obj.info_ref=d.Info.value;
      if(d.Encrypt)obj.encrypt=true;
      if(d.Size)obj.trailer_size=d.Size.value;
      obj.dict=d;
    }
    obj.has_stream=/\bstream\b/.test(body);
    out.objects.push(obj);
  }
  out.objects_gen0=Object.keys(seen).length;
  /* trailer: last 'trailer' keyword */
  var ti=s.lastIndexOf('trailer');
  var rootRef=null,infoRef=null;
  if(ti>=0){
    var td=parseDict(s,ti+7);
    if(td){
      if(td.Root)rootRef=td.Root.value;
      if(td.Info)infoRef=td.Info.value;
      if(td.Encrypt)out.encrypted=true;
      if(td.Size)out.trailer_size=td.Size.value;
    }
  } else out.warnings.push('no trailer dictionary found');
  if(out.encrypted)out.warnings.push('document is encrypted - strings and streams are ciphertext (not decrypted)');
  /* page tree root */
  function objByNum(n){for(var i=0;i<out.objects.length;i++)if(out.objects[i].num===n)return out.objects[i];return null;}
  var pagesRootCount=null;
  if(rootRef!==null){
    var rootObj=objByNum(rootRef);
    if(rootObj&&rootObj.dict&&rootObj.dict.Pages){
      var pagesObj=objByNum(rootObj.dict.Pages.value);
      if(pagesObj&&pagesObj.count!==undefined)pagesRootCount=pagesObj.count;
    }
  }
  if(pagesRootCount===null){
    for(var i=0;i<out.objects.length;i++)
      if(out.objects[i].type==='Pages'&&out.objects[i].count!==undefined){pagesRootCount=out.objects[i].count;break;}
  }
  out.pages_root_count=pagesRootCount;
  out.pages=pagesRootCount;
  /* metadata from Info */
  out.meta={};
  if(infoRef!==null&&!out.encrypted){
    var io=objByNum(infoRef);
    if(io&&io.dict){
      var map={Title:'title',Author:'author',Subject:'subject',Keywords:'keywords',Creator:'creator',Producer:'producer'};
      for(var k in map)if(io.dict[k]&&io.dict[k].kind==='string')out.meta[map[k]]=io.dict[k].value;
    }
  }
  /* strip dicts from the public object list */
  for(var i=0;i<out.objects.length;i++)delete out.objects[i].dict;
  return out;
}
var api={parse:parse};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.PdfLens=api;
})(typeof self!=='undefined'?self:this);
