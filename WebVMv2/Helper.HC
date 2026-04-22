/*
 * Helper.HC
 *
 * Copyright (c) 2026 Alec Murphy
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
Del("::/Tmp/Helper.HC", , , 0);

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

U0 PatchCallRel32(U32 from, U32 to)
{
    *(from(U8*)) = 0xE8;
    *((from + 1)(I32*)) = to - from - 5;
}

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

    h->helper_task = Spawn(&JsHelperTask, , "JsHelper Task");
    h->sig = JSHELPER_SIG;

    MemSetU32(BOOT_RAM_BASE, h, 1);
}

JsHelperInit;

/* JSLinux specific patches */

/* Call window.location.reload() on reboot request */
PatchJmpRel32(&BootRAM, &JsReboot);
PatchJmpRel32(&Reboot, &JsReboot);

Bool QwordHasTransparency(U64 v)
{
    U64 i = v ^ -1(U64);
    return (i - 0x0101010101010101) & 0x8080808080808080 & (~i & 0x8080808080808080);
}

/* Performance hack to run DCBlotColor8 on 8 pixels at a time when possible.
    DCBlotColor8 is only used once in the system, for copying the persistent
    layer (gr.dc) to gr.dc2 before updating the screen. We get a significant
    reduction in CPU usage during idle (20-25%, down from 65-70%)
*/
U0 DCBlotColor64(CDC* dc, CDC* img)
{
    U64 *src = img->body, *b0 = dc->body;
    I64 j, k, l, x, d0 = (img->width_internal * img->height) >> 3;
    for (k = 0; k < d0; k++) {
        j = *src++;
        if (j != -1(U64)) {
            l = *b0;
            if (QwordHasTransparency(j)) {
                for (x = 0; x < 8; x++) {
                    if (j.u8[x] != TRANSPARENT)
                        l.u8[x] = j.u8[x];
                }
                *b0 = l;
            } else {
                *b0 = j;
            }
        }
        b0++;
    }
}
PatchJmpRel32(&DCBlotColor8, &DCBlotColor64);

/* Performance hack used in Sprite3 to blot SPT_BITMAP 8 pixels at a
    time if possible.

    On first call, we check byte 0 of img->body, if it's less than 0x60,
    we perform the evaluation for any transparent pixels. If the byte is
    0xff, we never have to evaluate because we already have our answer.

    If we find any, we break and add 0x70 to the value at byte 0, or -
    if there are none - we add 0x60 to the value, to skip the check next
    time.

    Later on, we check if the value is less than 0x70, and add the
    DCF_NO_TRANSPARENTS flag if true.

    We add an additional check for the DCF_TRANSFORMATION flag on dc, and
    always use GrBlot3 if it is set to true.
*/
I64 GrOptBlot3(CDC* dc = gr.dc, I64 x, I64 y, I64 z, CDC* img)
{
    I64 u = *img->body;
    I64 v = 0x60;
    if (u < v) {
        // Scan img->body once for any transparent pixels
        U64* src = img->body;
        I64 j, k, d0 = (img->width_internal * img->height) >> 3;
        for (k = 0; k < d0; k++) {
            j = *src++;
            if (j == -1(U64)) {
                v = 0x70;
                break;
            } else {
                if (QwordHasTransparency(j)) {
                    v = 0x70;
                    break;
                }
            }
        }
        u += v;
        *img->body = u;
    }
    if (u < 0x70) {
        img->flags = DCF_NO_TRANSPARENTS;
        if (!(dc->flags & DCF_TRANSFORMATION)) {
            return GrBlot(dc, x, y, img);
        }
    }
    return GrBlot3(dc, x, y, z, img);
}
PatchCallRel32(&Sprite3 + 0x03d9, &GrOptBlot3);

/* Restore ACInit function prologue, so we can re-enable AutoComplete if desired */
*(&ACInit)(U64*) = 0x10ec8348ec8b4855;
