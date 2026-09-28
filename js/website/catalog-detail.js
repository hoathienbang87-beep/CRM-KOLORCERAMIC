import {formatProductSize,formatVndPerM2,safeExternalImageUrl} from "./catalog-api.js";
import {createQrSvg} from "./catalog-qr.js";

const cleanDetail=value=>value==null?"":String(value).trim();
const makeUuid=()=>{
  if(typeof crypto.randomUUID==="function")return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=[...bytes].map(item=>item.toString(16).padStart(2,"0"));
  return `${hex.slice(0,4).join("")}-${hex.slice(4,6).join("")}-${hex.slice(6,8).join("")}-${hex.slice(8,10).join("")}-${hex.slice(10).join("")}`;
};

export function createCatalogDetailApp({api,identifier,root=document,locationRef=location,navigatorRef=navigator,track=(event,detail)=>{
  const payload={event:`catalog_${event}`,...detail};
  window.dataLayer?.push(payload);
  window.dispatchEvent(new CustomEvent("kolor:catalog",{detail:payload}));
}}){
  const byId=id=>root.getElementById(id);
  const elements={catalog:byId("catalogView"),view:byId("productDetailView"),loading:byId("detailLoading"),content:byId("detailContent"),notFound:byId("detailNotFound"),error:byId("detailError"),retry:byId("detailRetry"),
    collection:byId("detailCollection"),name:byId("detailName"),code:byId("detailCode"),price:byId("detailPrice"),size:byId("detailSize"),surface:byId("detailSurface"),color:byId("detailColor"),origin:byId("detailOrigin"),description:byId("detailDescription"),
    mainMedia:byId("detailMainMedia"),mainImage:byId("detailMainImage"),imageFallback:byId("detailImageFallback"),thumbs:byId("detailThumbnails"),mediaLinks:byId("detailMediaLinks"),share:byId("nativeShare"),zalo:byId("zaloShare"),whatsApp:byId("whatsAppShare"),shareStatus:byId("shareStatus"),toggleQr:byId("toggleQr"),qrPanel:byId("qrPanel"),qr:byId("productQr"),downloadQr:byId("downloadQr"),
    leadForm:byId("leadForm"),leadName:byId("leadName"),leadPhone:byId("leadPhone"),leadEmail:byId("leadEmail"),leadMessage:byId("leadMessage"),leadCompany:byId("leadCompany"),leadConsent:byId("leadConsent"),leadContactError:byId("leadContactError"),leadSubmit:byId("leadSubmit"),leadStatus:byId("leadStatus")};
  const state={product:null,leadRequestId:makeUuid(),qrSvg:null};

  function show(name){for(const key of ["loading","content","notFound","error"])elements[key].classList.toggle("hide",key!==name);}
  function canonicalUrl(){const url=new URL(locationRef.href);url.search="";url.hash="";url.searchParams.set("id",state.product?.code||identifier);return url.href;}
  function setMainImage(url,name){
    elements.mainImage.classList.add("hide");elements.imageFallback.classList.remove("hide");elements.mainImage.removeAttribute("src");
    if(!url)return;
    elements.mainImage.alt=`Gạch ${name}`;
    elements.mainImage.onload=()=>{elements.mainImage.classList.remove("hide");elements.imageFallback.classList.add("hide");};
    elements.mainImage.onerror=()=>{elements.mainImage.classList.add("hide");elements.imageFallback.classList.remove("hide");elements.mainImage.removeAttribute("src");};
    elements.mainImage.src=url;
  }
  function renderGallery(product){
    const urls=[product.image_url,...(Array.isArray(product.gallery_urls)?product.gallery_urls:[])].map(safeExternalImageUrl).filter(Boolean);
    const unique=[...new Set(urls)];elements.thumbs.replaceChildren();setMainImage(unique[0]||"",product.name);
    for(const [index,url] of unique.entries()){
      const button=root.createElement("button");button.type="button";button.className=index===0?"active":"";button.setAttribute("aria-label",`Xem ảnh ${index+1}`);
      const image=root.createElement("img");image.src=url;image.alt="";image.loading="lazy";image.referrerPolicy="no-referrer";
      image.onerror=()=>button.remove();button.append(image);button.addEventListener("click",()=>{setMainImage(url,product.name);for(const item of elements.thumbs.children)item.classList.remove("active");button.classList.add("active");});elements.thumbs.append(button);
    }
    elements.thumbs.classList.toggle("hide",unique.length<2);
  }
  function addMediaLink(label,value,kind){
    const url=safeExternalImageUrl(value);if(!url)return;
    const link=root.createElement("a");link.href=url;link.target="_blank";link.rel="noopener noreferrer";link.textContent=label;
    link.addEventListener("click",()=>track("media_open",{product_id:state.product.id,media_type:kind}));elements.mediaLinks.append(link);
  }
  function setupSharing(){
    const url=canonicalUrl(),text=`${state.product.name} · ${formatProductSize(state.product)} · Kolorceramic`;
    elements.zalo.href=`https://zalo.me/share?url=${encodeURIComponent(url)}`;
    elements.whatsApp.href=`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;
    for(const [element,channel] of [[elements.zalo,"zalo"],[elements.whatsApp,"whatsapp"]])element.addEventListener("click",()=>track("share",{product_id:state.product.id,channel}));
    elements.share.onclick=async()=>{
      try{
        if(navigatorRef.share)await navigatorRef.share({title:state.product.name,text,url});
        else if(navigatorRef.clipboard?.writeText){await navigatorRef.clipboard.writeText(url);elements.shareStatus.textContent="Đã sao chép đường dẫn sản phẩm.";}
        else throw new Error("SHARE_UNAVAILABLE");
        track("share",{product_id:state.product.id,channel:navigatorRef.share?"native":"clipboard"});
      }catch(error){if(error?.name!=="AbortError")elements.shareStatus.textContent="Không thể chia sẻ tự động. Bạn có thể sao chép URL trên trình duyệt.";}
    };
    try{state.qrSvg=createQrSvg(url,root);elements.qr.replaceChildren(state.qrSvg);}catch{elements.qr.textContent="Không thể tạo QR cho URL này.";elements.toggleQr.disabled=true;}
    elements.toggleQr.onclick=()=>{const open=elements.qrPanel.classList.toggle("hide");elements.toggleQr.setAttribute("aria-expanded",String(!open));if(!open)track("qr_open",{product_id:state.product.id});};
    elements.downloadQr.onclick=()=>{
      if(!state.qrSvg)return;const source=new XMLSerializer().serializeToString(state.qrSvg);const blob=new Blob([source],{type:"image/svg+xml"});const objectUrl=URL.createObjectURL(blob);const link=root.createElement("a");link.href=objectUrl;link.download=`kolorceramic-${state.product.code||state.product.id}.svg`;link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),0);track("qr_download",{product_id:state.product.id});
    };
  }
  function render(product){
    state.product=product;root.title=`${product.name} · Kolorceramic`;elements.collection.textContent=product.collection||product.category||"KOLORCERAMIC";elements.name.textContent=product.name||"Sản phẩm";elements.code.textContent=product.code?`Mã sản phẩm: ${product.code}`:"";
    const price=formatVndPerM2(product.price_per_m2);elements.price.textContent=price;elements.price.classList.toggle("updating",price==="Đang cập nhật");elements.size.textContent=formatProductSize(product);elements.surface.textContent=product.surface||"Đang cập nhật";elements.color.textContent=product.color||"Đang cập nhật";elements.origin.textContent=product.origin||"Đang cập nhật";elements.description.textContent=product.description||"Thông tin chi tiết đang được cập nhật.";
    renderGallery(product);elements.mediaLinks.replaceChildren();addMediaLink("Xem catalogue PDF",product.pdf_url,"pdf");addMediaLink("Xem video",product.video_url,"video");addMediaLink("Thông tin thêm",product.more_info_url,"more_info");setupSharing();show("content");track("product_view",{product_id:product.id,identifier_type:identifier===product.id?"uuid":"code_or_legacy"});
  }
  function utm(){const params=new URL(locationRef.href).searchParams;return Object.fromEntries(["utm_source","utm_medium","utm_campaign","utm_term","utm_content"].map(key=>[key,cleanDetail(params.get(key))]).filter(([,value])=>value));}
  function leadErrorMessage(error){const message=cleanDetail(error?.message);if(message.includes("RATE_LIMITED"))return"Bạn đã gửi nhiều yêu cầu. Vui lòng thử lại sau 15 phút.";if(message.includes("VALIDATION")||message.includes("INVALID"))return"Thông tin chưa hợp lệ. Vui lòng kiểm tra và thử lại.";return"Chưa thể gửi yêu cầu. Vui lòng thử lại sau.";}
  async function submitLead(event){
    event.preventDefault();elements.leadContactError.textContent="";elements.leadStatus.textContent="";
    if(!elements.leadPhone.value.trim()&&!elements.leadEmail.value.trim()){elements.leadContactError.textContent="Vui lòng nhập số điện thoại hoặc email.";elements.leadPhone.focus();return;}
    if(!elements.leadForm.reportValidity())return;
    elements.leadSubmit.disabled=true;elements.leadSubmit.textContent="Đang gửi…";
    try{
      const result=await api.submitLead({request_id:state.leadRequestId,product_id:state.product.id,contact_name:elements.leadName.value.trim(),phone:elements.leadPhone.value.trim()||null,email:elements.leadEmail.value.trim()||null,message:elements.leadMessage.value.trim()||null,source_path:`${locationRef.pathname}${locationRef.search}`.slice(0,1000),utm:utm(),privacy_consent:elements.leadConsent.checked,anti_spam:{honeypot:elements.leadCompany.value,provider:"browser-form-v1"}});
      elements.leadForm.reset();elements.leadStatus.textContent="Đã nhận yêu cầu. Kolorceramic sẽ liên hệ với bạn sớm.";state.leadRequestId=makeUuid();track("lead_submit_success",{product_id:state.product.id,idempotent_replay:result?.idempotent_replay===true});
    }catch(error){elements.leadStatus.textContent=leadErrorMessage(error);track("lead_submit_error",{product_id:state.product.id,error_type:cleanDetail(error?.code)||"unknown"});}
    finally{elements.leadSubmit.disabled=false;elements.leadSubmit.textContent="Gửi yêu cầu tư vấn";}
  }
  async function load(){show("loading");try{const product=await api.get(identifier);if(!product){show("notFound");track("product_not_found",{identifier_length:cleanDetail(identifier).length});return;}render(product);}catch(error){if(error?.code==="22023")show("notFound");else show("error");}}
  function bind(){elements.catalog.classList.add("hide");elements.view.classList.remove("hide");elements.retry.addEventListener("click",load);elements.leadForm.addEventListener("submit",submitLead);}
  return{start(){bind();return load();},load,state};
}
