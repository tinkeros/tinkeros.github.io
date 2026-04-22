/*
 * templeos.js
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
"use strict";

var db;
const db_name = "JSLinux";
const object_store_name = db_name;

const last_ide_block_suffix = "0033.bin";
const locate_needle_interval = 500;
const helper_interval = 100;

const BLK_SIZE = 512;
const CDIRENTRY_SIZE = 64;
const CDIR_FILENAME_LEN = 38;
const U32_MAX = 0xffffffff;

const BOOT_RAM_BASE = 0x7c00;
const BOOT_SRC_RAM = 2;

const GR_HEIGHT = 480;
const GR_WIDTH = 640;

const RS_ATTR_CONTIGUOUS = 0x200;
const RS_ATTR_DIR = 0x10;

const adam_task = 0x100300;

const gr_palette_std_B = [
    0, 0, 0, 0, 0xaa, 0xaa, 0xaa, 0xaa, 0x55, 0x55, 0x55, 0x55, 0xff, 0xff,
    0xff, 0xff,
];
const gr_palette_std_G = [
    0, 0, 0xaa, 0xaa, 0, 0, 0x55, 0xaa, 0x55, 0x55, 0xff, 0xff, 0x55, 0x55,
    0xff, 0xff,
];
const gr_palette_std_R = [
    0, 0xaa, 0, 0xaa, 0, 0xaa, 0, 0xaa, 0x55, 0xff, 0x55, 0xff, 0x55, 0xff,
    0x55, 0xff,
];

const JS_CMD = 0x04;
const JS_CMD_V0 = JS_CMD + 0x04;
const JS_CMD_V1 = JS_CMD_V0 + 0x04;
const JS_CMD_V2 = JS_CMD_V1 + 0x04;
const JS_CMD_V3 = JS_CMD_V2 + 0x04;

const JS_CMD_NULL = 0;

const JS_CMD_REBOOT = 1;

const OS_CMD = JS_CMD_V3 + 0x04;
const OS_CMD_V0 = OS_CMD + 0x04;
const OS_CMD_V1 = OS_CMD_V0 + 0x04;
const OS_CMD_V2 = OS_CMD_V1 + 0x04;
const OS_CMD_V3 = OS_CMD_V2 + 0x04;

const OS_CMD_NULL = 0;

const OS_CMD_MALLOC = 1;
const OS_CMD_CALLOC = 2;
const OS_CMD_FREE = 3;

const OS_CMD_FILEREAD = 10;
const OS_CMD_FILEWRITE = 11;

const OS_CMD_CLIPDEL = 20;
const OS_CMD_CLIPSEND = 21;
const OS_CMD_CLIPRECV = 22;

const OS_CMD_ACINIT = 30;
const OS_CMD_MOUNTFILE = 31;

const OS_CMD_DBG = 255;

const JSHELPER_SIG = 0xfeedb0ca;

class CDirEntry {
    constructor(attr, name, clus, size, datetime, entries) {
        this.attr = attr;
        this.name = name;
        this.clus = clus;
        this.size = size;
        this.datetime = datetime;
        this.entries = entries;
    }
}

function pointer_to_glbl_data(str, offset, i) {
    offset += i * 8;
    let hash_ptr = os.mem.ptr(offset);
    let str_ptr = 0;
    let type = 0;

    while (hash_ptr) {
        str_ptr = os.mem.ptr(hash_ptr + 0x0008); // CHash.str
        if (
            array_matches_cstring_at_offset(
                HEAPU8,
                str,
                os.mem.heap_offset + str_ptr,
            )
        ) {
            type = os.mem.u32(hash_ptr + 0x0010); // CHash.type
            if (type & 1) {
                return os.mem.ptr(hash_ptr + 0x0040); // CHashExport
            }
            if (type & 8) {
                return os.mem.ptr(hash_ptr + 0x0078); // CHashGlblVar.data_addr
            }
            console.log(
                "unimplemented type: 0x" + type.toString(16).padStart(8, "0"),
            );
            return 0;
        }
        hash_ptr = os.mem.ptr(hash_ptr); // CHash.next
    }
    return 0;
}

function pointer_to_glbl(str) {
    const task = adam_task;
    const hash_table_ptr = os.mem.ptr(task + 0x03d0); // CTask.hash_table
    const body_ptr = os.mem.ptr(hash_table_ptr + 0x0018); // CHashTable.body
    const mask = os.mem.u32(hash_table_ptr + 0x0008); // CHashTable.mask
    let res = 0;

    for (let i = 0; i <= mask; i++) {
        res = pointer_to_glbl_data(str, body_ptr, i);
        if (res) {
            return res;
        }
    }
    return 0;
}

function read_dir_entry(offset) {
    const attr = os.mem.u16(offset);
    if (!attr) {
        return;
    }
    offset += 0x02;

    const name = cstring_at_offset(HEAPU8, os.mem.heap_offset + offset);
    offset += CDIR_FILENAME_LEN;

    const clus = os.mem.u32(offset);
    offset += 0x08;

    const size = os.mem.u32(offset);
    offset += 0x08;

    const datetime = os.mem.u32(offset);

    return new CDirEntry(
        attr,
        name,
        clus,
        size,
        datetime,
        attr & RS_ATTR_DIR ? read_dir_entries(clus) : null,
    );
}

function read_dir_entries(clus) {
    let entries = [];
    let offset = os.disk.ram_dsk + clus * BLK_SIZE;
    offset += CDIRENTRY_SIZE * 2; // Skip ".", ".."
    let entry = read_dir_entry(offset);
    while (typeof entry == "object") {
        entries.push(entry);
        offset += CDIRENTRY_SIZE;
        entry = read_dir_entry(offset);
    }
    return entries;
}

let os = {
    disk: {
        tree: [],
        update: function () {
            os.disk.tree = read_dir_entries(
                os.mem.u32(os.disk.ram_dsk + 0x7e18),
            ); // CDrv.root_clus
        },
    },
    glbl: {
        lookup: function (str) {
            const ptr = pointer_to_glbl(str);
            if (ptr) {
                os.glbl[str] = ptr;
            }
        },
    },
    gr: {
        take_screenshot: false,
    },
    helper: {
        cmd: function (
            cmd,
            v0 = -U32_MAX,
            v1 = -U32_MAX,
            v2 = -U32_MAX,
            v3 = -U32_MAX,
        ) {
            v0 == -U32_MAX ? 0 : os.memSet.u32(os.helper.ptr + OS_CMD_V0, v0);
            v1 == -U32_MAX ? 0 : os.memSet.u32(os.helper.ptr + OS_CMD_V1, v1);
            v2 == -U32_MAX ? 0 : os.memSet.u32(os.helper.ptr + OS_CMD_V2, v2);
            v3 == -U32_MAX ? 0 : os.memSet.u32(os.helper.ptr + OS_CMD_V3, v3);
            os.memSet.u32(os.helper.ptr + OS_CMD, cmd);
        },
        last_clus: 0x7f0ff,
        v0: () => os.mem.u32(os.helper.ptr + OS_CMD_V0),
        v1: () => os.mem.u32(os.helper.ptr + OS_CMD_V1),
        v2: () => os.mem.u32(os.helper.ptr + OS_CMD_V2),
        v3: () => os.mem.u32(os.helper.ptr + OS_CMD_V3),
        available: false,
    },
    mem: {
        heap_offset: 0,
        u32b: function (addr) {
            let res = 0;
            for (let i = 4; i < 8; i++) {
                res += HEAPU8[os.mem.heap_offset + addr + i] << (8 * i);
            }
            return res >>> 0;
        },
        u32: function (addr) {
            let res = 0;
            for (let i = 0; i < 4; i++) {
                res += HEAPU8[os.mem.heap_offset + addr + i] << (8 * i);
            }
            return res >>> 0;
        },
        u16: function (addr) {
            let res = 0;
            for (let i = 0; i < 2; i++) {
                res += HEAPU8[os.mem.heap_offset + addr + i] << (8 * i);
            }
            return res >>> 0;
        },
        u8: (addr) => HEAPU8[os.mem.heap_offset + addr],
        ptr: (addr) => os.mem.u32(addr),
    },
    memSet: {
        u32: function (addr, val) {
            for (let i = 0; i < 4; i++) {
                HEAPU8[os.mem.heap_offset + addr + i] = (val >> (8 * i)) & 0xff;
            }
        },
        u16: function (addr, val) {
            for (let i = 0; i < 2; i++) {
                HEAPU8[os.mem.heap_offset + addr + i] = (val >> (8 * i)) & 0xff;
            }
        },
        u8: function (addr, val) {
            HEAPU8[os.mem.heap_offset + addr] = val & 0xff;
        },
    },
    text: {},
};

function tools_peek() {
    var b = Number(vmem_addr.value),
        a = 0,
        d = 0,
        e = parseInt(vmem_mode.value);
    switch (e) {
        case 64:
            a = os.mem.u32(b);
            d = os.mem.u32b(b);
            break;
        case 32:
            a = os.mem.u32(b);
            break;
        case 16:
            a = os.mem.u16(b);
            break;
        case 8:
            a = os.mem.u8(b);
    }
    var c = "0x";
    switch (e) {
        case 64:
            c += d.toString(16).padStart(8, "0");
            c += a.toString(16).padStart(8, "0");
            break;
        case 32:
            c += a.toString(16).padStart(8, "0");
            break;
        case 16:
            c += a.toString(16).padStart(4, "0");
            break;
        default:
            c += a.toString(16).padStart(2, "0");
    }
    vmem_addr.value = "0x" + b.toString(16).padStart(8, "0");
    vmem_value.value = c;
}

function tools_poke() {
    let a = Number(vmem_addr.value),
        b = Number(vmem_value.value);
    switch (parseInt(vmem_mode.value)) {
        case 64:
            if (vmem_value.value.substr(0, 2) != "0x") {
                return;
            }
            let qword = vmem_value.value.slice(2).padStart(16, "0");
            os.memSet.u32(a + 0x04, Number("0x" + qword.substr(0, 8)));
            os.memSet.u32(a, Number("0x" + qword.substr(8, 16)));
            break;
        case 32:
            os.memSet.u32(a, b);
            break;
        case 16:
            os.memSet.u16(a, b);
            break;
        case 8:
            os.memSet.u8(a, b);
    }
    vmem_addr.value = "0x" + a.toString(16).padStart(8, "0");
}

function tools_screenshot() {
    os.gr.take_screenshot = true;
}

function download_vm_file_complete() {
    let data = "";
    const ptr = os.helper.v0();
    const size = os.helper.v1();
    for (let i = 0; i < size; i++) {
        data += String.fromCharCode(HEAPU8[os.mem.heap_offset + ptr + i]);
    }
    let link = document.createElement("a");
    link.download = os.helper.filename;
    link.href = "data:application/octet-stream;base64," + window.btoa(data);
    link.click();
    os.helper.cmd(OS_CMD_FREE, ptr);
}

function download_vm_file_pending() {
    if (os.mem.u32(os.helper.ptr + OS_CMD)) {
        setTimeout(download_vm_file_pending, helper_interval);
        return;
    }
    download_vm_file_complete();
}

function download_vm_file(path) {
    const path_components = path.split("/");
    os.helper.filename = path_components[path_components.length - 1];
    if (os.helper.filename.endsWith(".Z")) {
        os.helper.filename = os.helper.filename.slice(0, -2);
    }
    const filename_cstring_ptr = os.disk.ram_dsk + 0x7fffe * BLK_SIZE;
    copy_cstring_with_offset(
        HEAPU8,
        "::" + path,
        os.mem.heap_offset + filename_cstring_ptr,
    );
    os.helper.cmd(OS_CMD_FILEREAD, filename_cstring_ptr);
    setTimeout(download_vm_file_pending, helper_interval);
}

function populate_tree_dir_entries(tree, entries, path) {
    let ul = document.createElement("ul");
    for (let i = 0; i < entries.length; i++) {
        let li = document.createElement("li");
        const entry = entries[i];
        if (entry.attr & RS_ATTR_DIR) {
            let details = document.createElement("details");
            let summary = document.createElement("summary");
            summary.className = "direntry";
            summary.innerHTML = entries[i].name;
            details.appendChild(summary);
            populate_tree_dir_entries(
                details,
                entries[i].entries,
                path + entries[i].name + "/",
            );
            li.appendChild(details);
        } else {
            let a = document.createElement("a");
            a.href =
                "javascript:download_vm_file('" + path + entries[i].name + "')";
            a.innerHTML = entries[i].name;
            li.className = "direntry";
            li.appendChild(a);
        }
        ul.appendChild(li);
    }
    tree.appendChild(ul);
}

function tools_refresh_tree_view() {
    tools_tree_view.innerHTML = "";
    os.disk.update();
    let tree = document.createElement("ul");
    tree.classList = "tree";
    tree.style.padding = "0";
    let li = document.createElement("li");
    let details = document.createElement("details");
    let summary = document.createElement("summary");
    summary.className = "direntry";
    summary.innerHTML = "/";
    details.appendChild(summary);
    populate_tree_dir_entries(details, os.disk.tree, "/");
    li.appendChild(details);
    tree.appendChild(li);
    tools_tree_view.appendChild(tree);
}

function upload_file_complete() {
    const file = files.files[files.index];
    os.helper.cmd(OS_CMD_FREE, file.ptr);
    files.index++;
    setTimeout(request_upload_file, 200);
}

function upload_file_pending() {
    if (os.mem.u32(os.helper.ptr + OS_CMD)) {
        setTimeout(upload_file_pending, helper_interval);
        return;
    }
    upload_file_complete();
}

async function upload_file() {
    let file = files.files[files.index];
    file.ptr = os.helper.v0();
    if (!file.ptr) {
        console.log("upload_file: invalid ptr");
        return;
    }
    try {
        const buffer = await file.arrayBuffer();
        let data = new Uint8Array(buffer);
        const filename_cstring_ptr = os.disk.ram_dsk + 0x7fffe * BLK_SIZE;
        copy_cstring_with_offset(
            HEAPU8,
            "::" + "/Home/" + file.name,
            os.mem.heap_offset + filename_cstring_ptr,
        );
        copy_array_values_at_offset(
            HEAPU8,
            data,
            os.mem.heap_offset + file.ptr,
        );
        os.helper.cmd(
            OS_CMD_FILEWRITE,
            filename_cstring_ptr,
            file.ptr,
            file.size,
        );
        setTimeout(upload_file_pending, helper_interval);
    } catch (error) {
        console.error("Error reading file:", error);
        throw error;
    }
}

function request_upload_file_pending() {
    if (os.mem.u32(os.helper.ptr + OS_CMD)) {
        setTimeout(request_upload_file_pending, helper_interval);
        return;
    }
    upload_file();
}

function request_upload_file() {
    if (files.index >= files.files.length) {
        tools_refresh_tree_view();
        return;
    }
    const file = files.files[files.index];
    if (!file.size) {
        return;
    }
    os.helper.cmd(OS_CMD_CALLOC, file.size);
    setTimeout(request_upload_file_pending, helper_interval);
}

function tools_upload_files() {
    files.index = 0;
    request_upload_file();
}

function clip_del() {
    clip_text.value = "";
    os.helper.cmd(OS_CMD_CLIPDEL);
}

function clip_send() {
    const buffer = os.helper.v0();
    if (!buffer) {
        console.log("clip_send: invalid ptr");
        return;
    }
    copy_cstring_with_offset(
        HEAPU8,
        clip_text.value,
        os.mem.heap_offset + buffer,
    );
    os.helper.cmd(OS_CMD_CLIPSEND, buffer);
}

function request_clip_send_pending() {
    if (os.mem.u32(os.helper.ptr + OS_CMD)) {
        setTimeout(request_clip_send_pending, helper_interval);
        return;
    }
    clip_send();
}

function request_clip_send() {
    os.helper.cmd(OS_CMD_CALLOC, clip_text.value.length);
    setTimeout(request_clip_send_pending, helper_interval);
}

function tools_clip_send() {
    if (!clip_text.value.length) {
        clip_del();
    } else {
        request_clip_send();
    }
}

function clip_recv() {
    const buffer = os.helper.v0();
    if (!buffer) {
        console.log("clip_recv: invalid ptr");
        return;
    }
    clip_text.value = cstring_at_offset(HEAPU8, os.mem.heap_offset + buffer);
    os.helper.cmd(OS_CMD_FREE, buffer);
}

function request_clip_recv_pending() {
    if (os.mem.u32(os.helper.ptr + OS_CMD)) {
        setTimeout(request_clip_recv_pending, helper_interval);
        return;
    }
    clip_recv();
}

function request_clip_recv() {
    os.helper.cmd(OS_CMD_CLIPRECV);
    setTimeout(request_clip_recv_pending, helper_interval);
}

function tools_clip_recv() {
    request_clip_recv();
}

function array_matches_cstring_at_offset(arr, str, offset) {
    let i = 0;
    for (; i < str.length; i++) {
        if (arr[offset + i] != str.charCodeAt(i)) {
            return false;
        }
    }
    return arr[offset + i] == 0;
}

function cstring_at_offset(d, e) {
    for (var a = "", b = 0, c; ; ) {
        if ((c = d[e + b])) {
            a += String.fromCharCode(c);
        } else {
            break;
        }
        ++b;
    }
    return a;
}

function copy_cstring_with_offset(b, c, d) {
    let a = 0;
    for (; a < c.length; a++) {
        b[d + a] = c.charCodeAt(a);
    }
    b[d + a] = 0;
}

async function fetch_file_as_arraybuffer(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error, status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return arrayBuffer;
    } catch (error) {
        console.error("Fetch failed: ", error);
        throw error;
    }
}

function copy_array_values_at_offset(dst, src, offset) {
    for (let i = 0; i < src.length; i++) {
        dst[offset + i] = src[i];
    }
}

function lookup_glbl_values_for_boot() {
    const values = [
        "blkdev",
        "ms",
        "sys_boot_src",
        "sys_run_level",
        "text",
    ].forEach(function (value) {
        os.glbl.lookup(value);
    });
}

function get_disk_values_for_boot() {
    os.disk.drv = os.mem.ptr(os.glbl.blkdev + 0x0060); // CBlkDevGlbls.let_to_drv[0]
    os.disk.blkdev = os.mem.ptr(os.disk.drv + 0x0068); // CDrv.bd
    os.disk.ram_dsk = os.mem.ptr(os.disk.blkdev + 0x004c); // CBlkDev.RAM_dsk
}

function set_ram_disk_root_cluster() {
    const root_clus = os.mem.u32(os.disk.ram_dsk + 0x7e18);
    os.memSet.u32(os.disk.drv + 0x0040, root_clus); // CDrv.root_clus
}

function set_sys_boot_src(src) {
    os.memSet.u8(os.glbl.sys_boot_src, src);
}

function set_boot_drv_let(drv_let) {
    os.memSet.u8(os.glbl.blkdev + 0x0178, drv_let.charCodeAt(0)); // CBlkDevGlbls.boot_drv_let
}

function resize_graphic_display() {
    graphic_display.canvas_el.width = GR_WIDTH;
    graphic_display.canvas_el.style.width = GR_WIDTH.toString() + "px";
}

function bit_test(b, a) {
    return (os.mem.u8(b + parseInt(a / 8)) >> (a % 8)) & 1;
}

function tools_acinit() {
    os.helper.cmd(OS_CMD_ACINIT, 0);
    btn_acinit.style.background = "lime";
}

function tools_disk_image_attach() {
    let path = isoc_disk_image.value;
    if (path == "") {
        return;
    }
    isoc_disk_image.disabled = btn_attach.disabled = "disabled";
    isoc_disk_image.style.background = btn_attach.style.background = "olive";
    fetch_file_as_arraybuffer(path)
        .then((buffer) => {
            os.disk.update();
            const path_components = path.split("/");
            const filename = path_components[path_components.length - 1];
            const isoc_path = "::/Tmp/" + filename;
            append_fs_file_from_array(isoc_path, new Uint8Array(buffer));
            os.disk.update();
            const isoc_path_cstring_ptr = os.disk.ram_dsk + 0x7fffe * BLK_SIZE;
            copy_cstring_with_offset(
                HEAPU8,
                isoc_path,
                os.mem.heap_offset + isoc_path_cstring_ptr,
            );
            os.helper.cmd(
                OS_CMD_MOUNTFILE,
                isoc_path_cstring_ptr,
                cb_autorun.checked,
            );
            isoc_disk_image.style.background = btn_attach.style.background =
                "lime";
        })
        .catch((error) => {
            console.error("Error in processing:", error);
        });
}

function refresh_gr_display() {
    os.glbl.gr === void 0 && os.glbl.lookup("gr");
    os.gr.scrn_image === void 0 &&
        (os.gr.scrn_image = os.mem.ptr(os.mem.ptr(os.glbl.gr + 16) + 384));
    var d = graphic_display.image.data,
        f,
        g,
        b = 0,
        e = os.gr.scrn_image,
        c = 0;
    for (g = 0; g < GR_HEIGHT; g++) {
        for (f = 0; f < GR_WIDTH; f++) {
            var a = 0;
            bit_test(e, c) && (a |= 1);
            bit_test(e + 38400, c) && (a |= 2);
            bit_test(e + 76800, c) && (a |= 4);
            bit_test(e + 115200, c) && (a |= 8);
            c++;
            d[b] = gr_palette_std_B[a];
            d[b + 1] = gr_palette_std_G[a];
            d[b + 2] = gr_palette_std_R[a];
            d[b + 3] = 255;
            b += 4;
        }
        b += (graphic_display.image.width - GR_WIDTH) << 2;
    }
}

function refresh_raw_display() {
    const h = os.text.raw_scrn_image;
    let b = graphic_display.image.data,
        c = 0,
        d = 7,
        e,
        f,
        a = 0,
        k = os.mem.u8(h + c);
    for (f = 0; f < GR_HEIGHT; f++) {
        for (e = 0; e < GR_WIDTH; e++) {
            var g = (k >> d--) & 1 ? 255 : 0;
            d < 0 && ((d = 7), c++, (k = os.mem.u8(h + c)));
            b[a] = g;
            b[a + 1] = g;
            b[a + 2] = g;
            b[a + 3] = 255;
            a += 4;
        }
        a += (graphic_display.image.width - GR_WIDTH) << 2;
    }
}

function save_screenshot() {
    var link = document.createElement("a");
    link.download = "screenshot.png";
    link.href = graphic_display.canvas_el
        .toDataURL("image/png")
        .replace(/^data:image\/[^;]/, "data:application/octet-stream");
    link.click();
}

function check_helper_status() {
    os.helper.ptr = os.mem.u32(BOOT_RAM_BASE);
    if (os.helper.ptr) {
        os.helper.available = os.mem.u32(os.helper.ptr) == JSHELPER_SIG;
    }
    if (os.helper.available) {
        document.querySelectorAll(".ctrl").forEach((e) => (e.disabled = ""));
        files.disabled = "";
        tools_refresh_tree_view();
        console.log("js helper installed");
    }
}

function poll_helper() {
    if (!os.helper.available) {
        check_helper_status();
        return;
    }
    switch (
        os.mem.u32(os.helper.ptr + 0x04) // CJsHelper.js_cmd
    ) {
        case JS_CMD_REBOOT:
            os.reboot = true;
            window.location.reload();
            break;
        default:
            break;
    }
}

function refresh_display() {
    if (os.reboot) {
        return;
    }
    if (
        os.mem.u32(os.glbl.sys_run_level) < 0x8000 ||
        os.mem.u32(os.glbl.text + 0x0008)
    ) {
        refresh_raw_display();
    } else {
        refresh_gr_display();
    }
    graphic_display.ctx.putImageData(
        graphic_display.image,
        0,
        0,
        0,
        0,
        graphic_display.image.width,
        graphic_display.image.height,
    );
    if (os.gr.take_screenshot) {
        save_screenshot();
        os.gr.take_screenshot = false;
    }
    requestAnimationFrame(refresh_display);
    poll_helper();
}

function init_text_mode() {
    os.text.raw_scrn_image = os.mem.ptr(os.glbl.text + 0x0010); // CTextGlbls.raw_scrn_image
}

function init_display() {
    requestAnimationFrame(refresh_display);
}

function copy_disk_image_data_to_ram_disk() {
    copy_array_values_at_offset(
        HEAPU8,
        os.disk.image_data,
        os.mem.heap_offset + os.disk.ram_dsk,
    );
}

function updateMousePos(e) {
    const rect = graphic_display.canvas_el.getBoundingClientRect();
    os.memSet.u16(0xbf68, e.clientX - rect.left);
    os.memSet.u16(0xbf70, e.clientY - rect.top);
}

function update_mouse_pos(e) {
    const rect = graphic_display.canvas_el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const text_rows = os.mem.u32(os.glbl.text + 0x0018); // text.rows;
    const text_cols = os.mem.u32(os.glbl.text + 0x0020); // text.cols;
    os.memSet.u32(os.glbl.ms, x); // CMsStateGlbls pos.x
    os.memSet.u32(os.glbl.ms + 0x0008, y); // CMsStateGlbls pos.y
    os.memSet.u32(os.glbl.ms + 0x0018, parseInt(x / (GR_WIDTH / text_cols))); // CMsStateGlbls pos_text.x
    os.memSet.u32(os.glbl.ms + 0x0020, parseInt(y / (GR_HEIGHT / text_rows))); // CMsStateGlbls pos_text.y
}

function init_mouse_events() {
    graphic_display.canvas_el.addEventListener("mousemove", update_mouse_pos);
    graphic_display.canvas_el.onmousedown = function (e) {
        os.memSet.u8(os.glbl.ms + 0x00a0 + (e.button == 2), 1); // CMsStateGlbls lb, rb
    };
    graphic_display.canvas_el.onmouseup = function (e) {
        os.memSet.u8(os.glbl.ms + 0x00a0 + (e.button == 2), 0); // CMsStateGlbls lb, rb
    };
}

function append_fs_dir_entry(clus, entry) {
    let offset = os.disk.ram_dsk + clus * BLK_SIZE;
    let attr = os.mem.u16(offset);
    while (attr) {
        offset += CDIRENTRY_SIZE;
        attr = os.mem.u16(offset);
    }
    os.memSet.u16(offset, entry.attr);
    offset += 0x02;

    copy_cstring_with_offset(HEAPU8, entry.name, os.mem.heap_offset + offset);
    offset += CDIR_FILENAME_LEN;

    os.memSet.u32(offset, entry.clus);
    offset += 0x08;

    os.memSet.u32(offset, entry.size);
    offset += 0x08;

    // FIXME: DateTime
    os.memSet.u32(offset, 0);
    offset += 0x04;
    os.memSet.u32(offset, 0);
}

function append_fs_dir_entry_to_dir(path, entry) {
    const path_components = path.split("/");
    let dir_entries = os.disk.tree;
    let clus = 0;
    let i = 1;
    while (i < path_components.length - 1) {
        for (let j = 0; j < dir_entries.length; j++) {
            if (dir_entries[j].name == path_components[i]) {
                clus = dir_entries[j].clus;
                dir_entries = dir_entries[j].entries;
                i++;
            }
        }
        if (!clus) {
            console.log(
                "append_fs_dir_entry_to_dir: couldn't find directory named '" +
                    dir_name +
                    "'",
            );
            return;
        }
    }
    append_fs_dir_entry(clus, entry);
}

function append_fs_file_from_string(path, str) {
    const path_components = path.split("/");
    const filename = path_components[path_components.length - 1];
    const size = str.length;
    os.helper.last_clus -= Math.ceil(size / BLK_SIZE);
    const entry = new CDirEntry(
        RS_ATTR_CONTIGUOUS,
        filename,
        os.helper.last_clus,
        size,
        0,
        [],
    );
    copy_cstring_with_offset(
        HEAPU8,
        str,
        os.mem.heap_offset + os.disk.ram_dsk + os.helper.last_clus * BLK_SIZE,
    );
    append_fs_dir_entry_to_dir(path, entry);
}

function append_fs_file_from_array(path, array) {
    const path_components = path.split("/");
    const filename = path_components[path_components.length - 1];
    const size = array.length;
    os.helper.last_clus -= Math.ceil(size / BLK_SIZE);
    const entry = new CDirEntry(
        RS_ATTR_CONTIGUOUS,
        filename,
        os.helper.last_clus,
        size,
        0,
        [],
    );
    copy_array_values_at_offset(
        HEAPU8,
        array,
        os.mem.heap_offset + os.disk.ram_dsk + os.helper.last_clus * BLK_SIZE,
    );
    append_fs_dir_entry_to_dir(path, entry);
}

function install_js_helper(buffer) {
    const homesys_str =
        'Del("::/Home/HomeSys.HC",,,0);AdamFile("::/Tmp/Helper");*(&ACInit)(U64*)=0x8c25dec8b4855;#include "::/HomeSys";';
    append_fs_file_from_string("::/Home/HomeSys.HC", homesys_str);
    append_fs_file_from_array("::/Tmp/Helper.HC", new Uint8Array(buffer));
}

function continue_boot_configuration() {
    lookup_glbl_values_for_boot();
    get_disk_values_for_boot();

    resize_graphic_display();
    init_text_mode();
    init_display();

    init_mouse_events();

    copy_disk_image_data_to_ram_disk();
    set_ram_disk_root_cluster();
    set_sys_boot_src(BOOT_SRC_RAM);

    fetch_file_as_arraybuffer("/WebVM/Helper.HC")
        .then((buffer) => {
            os.disk.update();

            install_js_helper(buffer);

            os.disk.update();
            set_boot_drv_let("A");
        })
        .catch((error) => {
            console.error("Error in processing:", error);
        });

    tools_container.style = "";
}

function locate_needle_in_vm_heap() {
    for (let i = 0; i < HEAPU8.length; i++) {
        if (array_matches_cstring_at_offset(HEAPU8, "JSLinux!", i)) {
            os.memSet.u32(BOOT_RAM_BASE, 0);
            os.mem.heap_offset = i - BOOT_RAM_BASE;
            continue_boot_configuration();
            return;
        }
    }
    setTimeout(locate_needle_in_vm_heap, locate_needle_interval);
}

function boot_os() {
    term_container.innerHTML = "";
    start_vm(null, null);
}

function set_ctrl_defaults() {
    document
        .querySelectorAll(".ctrl")
        .forEach((e) => (e.disabled = "disabled"));
    files.disabled = "disabled";
    isoc_disk_image.selectedIndex = 0;
    vmem_addr.value = vmem_value.value = clip_text.value = "";
}

function fetch_os_disk_image() {
    fetch_file_as_arraybuffer("/WebVM/disk.img")
        .then((buffer) => {
            os.disk.image_data = new Uint8Array(buffer);
            db.transaction([object_store_name], "readwrite")
                .objectStore(object_store_name)
                .put(os.disk.image_data, "disk_image");
            boot_os();
        })
        .catch((error) => {
            console.error("Error in processing:", error);
        });
}
function set_os_disk_image_data() {
    const request = indexedDB.open(db_name, new Date().getTime());
    request.onupgradeneeded = function (event) {
        const _db = event.target.result;
        if (!_db.objectStoreNames.contains(object_store_name)) {
            _db.createObjectStore(object_store_name);
        }
    };
    request.onsuccess = function (e) {
        db = e.target.result;
        db
            .transaction([object_store_name], "readwrite")
            .objectStore(object_store_name)
            .get("disk_image").onsuccess = function (e) {
            if (e.target.result) {
                os.disk.image_data = e.target.result;
                boot_os();
            } else {
                fetch_os_disk_image();
            }
        };
    };
}

(function () {
    const xhr_default_open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
        method,
        url,
        async,
        user,
        password,
    ) {
        if (url.endsWith(last_ide_block_suffix)) {
            setTimeout(locate_needle_in_vm_heap, locate_needle_interval);
        }
        xhr_default_open.apply(this, arguments);
    };
})();


// Function to download a file from Emscripten's virtual filesystem
function downloadFileFromJS(filename) {
    // 1. Get the file data as a Uint8Array
    const data = FS.readFile("disk.img");
    
    // 2. Create a Blob object from the data
    const blob = new Blob([data.buffer], { type: "application/octet-stream" });
    
    // 3. Create a URL for the blob
    const url = URL.createObjectURL(blob);
    
    // 4. Create a temporary anchor element and trigger a click
    const a = document.createElement('a');
    a.href = url;
    a.download = filename; // Suggests a filename for the download
    document.body.appendChild(a);
    a.click();
    
    // 5. Clean up the temporary URL and element
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function download_os_disk_image() {
    // Fetch the disk image from the IndexedDB (or wherever it's stored)
    db.transaction([object_store_name], "readonly")
        .objectStore(object_store_name)
        .get("disk_image")
        .onsuccess = function(event) {
            //const diskImageData = event.target.result;
            const diskImageData = event.srcElement.result;
            
            if (diskImageData) {
                // Create a Blob from the disk image data
                const blob = new Blob([diskImageData], { type: "application/octet-stream" });
                
                // Create a temporary anchor element to trigger the download
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = 'disk.img'; // Filename for the download
                
                // Append the link to the document body (required for Firefox)
                document.body.appendChild(link);
                
                // Simulate a click on the link to start the download
                link.click();
                
                // Clean up by removing the link
                document.body.removeChild(link);
            } else {
                console.error("Disk image not found in storage.");
            }
        }
        .onerror = function(error) {
            console.error("Error fetching disk image:", error);
        };
}

window.onload = function () {
    set_ctrl_defaults();
    set_os_disk_image_data();
    term_container.innerHTML = "Loading...";
};
