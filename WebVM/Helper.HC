Del("::/Tmp/Helper.HC");

#define JSHELPER_SIG 0xfeedb0ca

#define JS_CMD_NULL 0

#define JS_CMD_REBOOT 1

#define OS_CMD_NULL 0

#define OS_CMD_MALLOC 1
#define OS_CMD_CALLOC 2
#define OS_CMD_FREE 3

#define OS_CMD_FILEREAD 10
#define OS_CMD_FILEWRITE 11

#define OS_CMD_CLIPDEL 20
#define OS_CMD_CLIPSEND 21
#define OS_CMD_CLIPRECV 22

#define OS_CMD_ACINIT 30
#define OS_CMD_MOUNTFILE 31

#define OS_CMD_DBG 255

#define OS_CMD_DONE h->os_cmd = 0;

class CJsHelper {
    U32 sig;
    U32 js_cmd;    // OS requesting JS to perform some task
    U32 js_cmd_v0; // general purpose U32s, 0-3
    U32 js_cmd_v1;
    U32 js_cmd_v2;
    U32 js_cmd_v3;
    U32 os_cmd;    // JS requesting OS to perform some task
    U32 os_cmd_v0; // general purpose U32s, 0-3
    U32 os_cmd_v1;
    U32 os_cmd_v2;
    U32 os_cmd_v3;
    CTask* helper_task;
};

U0 PatchJmpRel32(U32 from, U32 to)
{
    *(from(U8*)) = 0xE9;
    *((from + 1)(I32*)) = to - from - 5;
}

U0 JsReboot()
{
    CJsHelper* h = *(BOOT_RAM_BASE)(U32*);
    h->js_cmd = JS_CMD_REBOOT;
    while (1) {
        Sleep(1);
    }
}

U0 OsMAlloc(CJsHelper* h)
{
    U32 size = h->os_cmd_v0;
    h->os_cmd_v0 = MAlloc(size);
}

U0 OsCAlloc(CJsHelper* h)
{
    U32 size = h->os_cmd_v0;
    h->os_cmd_v0 = CAlloc(size);
}

U0 OsFree(CJsHelper* h)
{
    U64 p = h->os_cmd_v0;
    Free(p);
}

U0 OsFileRead(CJsHelper* h)
{
    U8* path = h->os_cmd_v0;
    I64 size = 0;
    h->os_cmd_v0 = FileRead(path, &size);
    h->os_cmd_v1 = size;
}

U0 OsFileWrite(CJsHelper* h)
{
    U8* path = h->os_cmd_v0;
    U8* buf = h->os_cmd_v1;
    U32 size = h->os_cmd_v2;
    h->os_cmd_v0 = FileWrite(path, buf, size);
}

U0 OsClipSend(CJsHelper* h)
{
    U8* buf = h->os_cmd_v0;
    if (!buf) {
        return;
    }
    ClipDel;
    DocPutS(sys_clip_doc, buf);
    Free(buf);
}

U0 OsClipRecv(CJsHelper* h)
{
    U8* p = CAlloc(DocSize(sys_clip_doc));
    CDoc* tmpd = Doc2TXT(sys_clip_doc);
    CDocEntry* tmpde = tmpd->head.next;
    while (tmpde != tmpd) {
        if (tmpde->tag) {
            StrCpy(p + StrLen(p), tmpde->tag);
            StrCpy(p + StrLen(p), "\n");
        }
        tmpde = tmpde->next;
    }
    DocDel(tmpd);
    if (StrLen(p)) {
        p[StrLen(p) - 1] = NULL;
    }
    h->os_cmd_v0 = p;
}

U0 OsACInit()
{
    if (!ac.num_words) {
        ACInit("/*;!*/Bible.TXT*");
    }
}

U0 OsMountFile(CJsHelper* h)
{
    U8* isoc_path = h->os_cmd_v0;
    Bool autorun = h->os_cmd_v1;
    MountFile(isoc_path);
    if (autorun) {
        User("DskChg('M');\n#include \"Run\";\n");
    }
}

U0 JsHelperTask()
{
    CJsHelper* h = *(BOOT_RAM_BASE)(U32*);
    while (1) {
        switch (h->os_cmd) {

        case OS_CMD_MALLOC:
            OsMAlloc(h);
            OS_CMD_DONE
            break;
        case OS_CMD_CALLOC:
            OsCAlloc(h);
            OS_CMD_DONE
            break;
        case OS_CMD_FREE:
            OsFree(h);
            OS_CMD_DONE
            break;

        case OS_CMD_FILEREAD:
            OsFileRead(h);
            OS_CMD_DONE
            break;
        case OS_CMD_FILEWRITE:
            OsFileWrite(h);
            OS_CMD_DONE
            break;

        case OS_CMD_CLIPDEL:
            ClipDel;
            OS_CMD_DONE
            break;
        case OS_CMD_CLIPSEND:
            OsClipSend(h);
            OS_CMD_DONE
            break;
        case OS_CMD_CLIPRECV:
            OsClipRecv(h);
            OS_CMD_DONE
            break;

        case OS_CMD_ACINIT:
            OsACInit;
            OS_CMD_DONE
            break;
        case OS_CMD_MOUNTFILE:
            OsMountFile(h);
            OS_CMD_DONE
            break;

        case OS_CMD_DBG:
            Dbg;
            OS_CMD_DONE
            break;

        default:
            break;
        }
        Sleep(1);
    }
}

U0 JsHelperInit()
{
    CJsHelper* h = CAlloc(sizeof(CJsHelper));

    h->helper_task = Spawn(&JsHelperTask, "JsHelper Task");
    h->sig = JSHELPER_SIG;

    MemSetU32(BOOT_RAM_BASE, h, 1);
}

PatchJmpRel32(&BootRAM, &JsReboot);
PatchJmpRel32(&Reboot, &JsReboot);

JsHelperInit;

*(&ACInit)(U64*) = 0x10ec8348ec8b4855;
