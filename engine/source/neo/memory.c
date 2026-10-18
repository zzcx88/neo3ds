/*  gngeo a neogeo emulator
 *  Copyright (C) 2001 Peponas Mathieu
 * 
 *  This program is free software; you can redistribute it and/or modify  
 *  it under the terms of the GNU General Public License as published by   
 *  the Free Software Foundation; either version 2 of the License, or    
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Library General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA 02111-1307, USA. 
 */

#ifdef HAVE_CONFIG_H
#include <config.h>
#endif

#include "emu.h"
#include "video.h"
#include "memory.h"
#include "pd4990a.h"
#include "savestate.h"
#include <stddef.h>
#include "transpack.h"

#ifdef GP2X
#include "ym2610-940/940shared.h"
#endif

Uint8 (*mem68k_fetch_bksw_byte)(Uint32);
Uint16 (*mem68k_fetch_bksw_word)(Uint32);
Uint32 (*mem68k_fetch_bksw_long)(Uint32);
void (*mem68k_store_bksw_byte)(Uint32,Uint8);
void (*mem68k_store_bksw_word)(Uint32,Uint16);
void (*mem68k_store_bksw_long)(Uint32,Uint32);

neo_mem memory;

Uint8 *current_pal;
Uint32 *current_pc_pal;
Uint8 *current_fix;
Uint8 *fix_usage;
Uint8 sram_lock;
Uint8 sound_code;
Uint8 pending_command;
Uint8 result_code;
Uint16 z80_bank[4];

Uint32 bankaddress = 0;
int dbg_sound_cmds, dbg_result_writes; /* neo3ds diagnostics */
extern int current_line;



void neogeo_sound_irq(int irq) {
    //core_log("neogeo_sound_irq %d\n",irq);
#ifndef ENABLE_940T
    if (irq) {
        cpu_z80_raise_irq(0);
    } else
        cpu_z80_lower_irq();
#endif
    //core_log("neogeo_sound_end %d\n",irq);
}

static __inline__ Uint16 read_neo_control(void) {
  
    unsigned int scan;

    /* neo3ds: neo_run_frame() advances the CPUs one scanline at a time, so
     * current_line is exact in both modes (games poll this to sync to the beam). */
    if (0) {

#ifdef PROCESSOR_ARM
#ifdef USE_CYCLONE
        scan = current_line;
        /*
          core_log("%d %d %d\n",current_line,
          (cpu_68k_getcycle()/3)>>7,
          (int)(cpu_68k_getcycle() / 766.28));
        */
#else
        scan = cpu_68k_getcycle()/3;
        scan = scan>>7;
#endif
#else
        scan = cpu_68k_getcycle() / 766.28; /* current scanline */
#endif

        //	scan+=0x100;
        //	if (scan >=0x200) scan=scan-0x108;
        scan += 0xF8;

        return (scan << 7) | (conf.pal << 3) | (neogeo_frame_counter & 0x0007); /* frame counter */

    } else {
        scan = current_line /*+ 22*/; /* current scanline */
        //scan+=0x110;
        //if (scan >=0x200) scan=scan-0x108;
        scan += 0xF8;

        return (scan << 7) | (conf.pal << 3) | (neogeo_frame_counter & 0x0007); /* frame counter */
    }
}

__inline__ void write_neo_control(Uint16 data) {
    neogeo_frame_counter_speed = (((data >> 8) & 0xff) + 1);
    memory.vid.irq2control = data & 0xff;
    return;
}

__inline__ void write_irq2pos(Uint32 data) {
    memory.vid.irq2pos = data;
    if (memory.vid.irq2control & 0x20) {
        int line = (memory.vid.irq2pos + 0x3b) / 0x180; /* turfmast goes as low as 0x145 */
        memory.vid.irq2start = line + current_line;
    }
}

#ifndef ENABLE_940T
/* Z80 IO port handler */
Uint8 z80_port_read(Uint16 PortNo)
{
    //core_log("z80_port_read PC=%04x p=%04x ",cpu_z80_get_pc(),PortNo);
    //core_log("z80_port_read p=%04x \n",PortNo);
    switch (PortNo & 0xff) {
    case 0x0:
        pending_command = 0;
        cpu_z80_ack_command();
        //core_log("Reseting command. Return sndcode %x\n",sound_code);
        return sound_code;
        break;

    case 0x4:
        //core_log("v=%02x\n",YM2610_status_port_0_A_r(0));
        return YM2610_status_port_A_r(0);
        break;

    case 0x5:
        //core_log("v=%02x\n",YM2610_read_port_0_r(0));
        return YM2610_read_port_r(0);
        break;

    case 0x6:
        //core_log("v=%02x\n",YM2610_status_port_0_B_r(0));
        return YM2610_status_port_B_r(0);
        break;

    case 0x08:
        //core_log("v=00 (sb3)\n");
        cpu_z80_switchbank(3, PortNo);
        return 0;
        break;

    case 0x09:
        //core_log("v=00 (sb2)\n");
        cpu_z80_switchbank(2, PortNo);
        return 0;
        break;

    case 0x0a:
        //core_log("v=00 (sb1)\n");
        cpu_z80_switchbank(1, PortNo);
        return 0;
        break;

    case 0x0b:
        //core_log("v=00 (sb0)\n");
        cpu_z80_switchbank(0, PortNo);
        return 0;
        break;
    };

    return 0;
}

void z80_port_write(Uint16 PortNb, Uint8 Value)
{
    Uint8 data = Value;
    //core_log("z80_port_write PC=%04x OP=%02x p=%04x v=%02x\n",cpu_z80_get_pc(),memory.rom.cpu_z80.p[cpu_z80_get_pc()],PortNb,Value);
    //core_log("Write port %04x %02x\n",PortNb,Value);
    switch (PortNb & 0xff) {
    case 0x4:
        YM2610_control_port_A_w(0, data);
        break;

    case 0x5:
        YM2610_data_port_A_w(0, data);
        break;

    case 0x6:
        YM2610_control_port_B_w(0, data);
        break;

    case 0x7:
        YM2610_data_port_B_w(0, data);
        break;

    case 0x08:
        cpu_z80_set_nmi_enable(1);
        break;

    case 0x18:
        cpu_z80_set_nmi_enable(0);
        break;

    case 0xC:
        //core_log("Setting result code to %0x\n",Value);
        result_code = Value;
        dbg_result_writes++;
        break;
    }
}
#endif

/* Protection hack */
Uint16 protection_9a37(Uint32 addr) {
    return 0x9a37;
}

/* fetching function */
/**** INVALID FETCHING ****/
Uint8 mem68k_fetch_invalid_byte(Uint32 addr) {
    return 0xF0;
}

Uint16 mem68k_fetch_invalid_word(Uint32 addr) {
    return 0xF0F0;
}

Uint32 mem68k_fetch_invalid_long(Uint32 addr) {
    return 0xF0F0F0F0;
}

/**** RAM FETCHING ****/
Uint8 mem68k_fetch_ram_byte(Uint32 addr) {
    //  core_log("mem68k_fetch_ram_byte %x\n",addr);
    addr &= 0xffff;
    return (READ_BYTE_ROM(memory.ram + addr));
}

Uint16 mem68k_fetch_ram_word(Uint32 addr) {
    //core_log("mem68k_fetch_ram_word %08x %04x\n",addr,READ_WORD_RAM(memory.ram + (addr&0xffff)));
    addr &= 0xffff;
    return (READ_WORD_ROM(memory.ram + addr));
}

LONG_FETCH(mem68k_fetch_ram)
;

/**** CPU ****/
Uint8 mem68k_fetch_cpu_byte(Uint32 addr) {
    addr &= 0xFFFFF;

    return (READ_BYTE_ROM(memory.rom.cpu_m68k.p + addr));
}

Uint16 mem68k_fetch_cpu_word(Uint32 addr) {
    addr &= 0xFFFFF;

    return (READ_WORD_ROM(memory.rom.cpu_m68k.p + addr));
}

LONG_FETCH(mem68k_fetch_cpu)
;

/**** BIOS ****/
Uint8 mem68k_fetch_bios_byte(Uint32 addr) {
    addr &= 0x1FFFF;
    return (READ_BYTE_ROM(memory.rom.bios_m68k.p + addr));
}

Uint16 mem68k_fetch_bios_word(Uint32 addr) {
    addr &= 0x1FFFF;
    return (READ_WORD_ROM(memory.rom.bios_m68k.p + addr));
}

LONG_FETCH(mem68k_fetch_bios)
;

/**** SRAM ****/
Uint8 mem68k_fetch_sram_byte(Uint32 addr) {
    return memory.sram[addr - 0xd00000];
}

Uint16 mem68k_fetch_sram_word(Uint32 addr) {
    addr = (addr - 0xd00000) & 0xfffe; /* neo3ds: a word never straddles the end of the RAM */
    return (memory.sram[addr] << 8) | (memory.sram[addr + 1] & 0xff);
}

LONG_FETCH(mem68k_fetch_sram)
;

/**** PALETTE ****/
Uint8 mem68k_fetch_pal_byte(Uint32 addr) {
    addr &= 0xffff;
    if (addr <= 0x1fff)
        return current_pal[addr];
    return 0;
}

Uint16 mem68k_fetch_pal_word(Uint32 addr) {
    addr &= 0xffff;
    if (addr <= 0x1fff)
        return READ_WORD(&current_pal[addr]);
    return 0;
}

LONG_FETCH(mem68k_fetch_pal)
;

/**** VIDEO ****/
Uint8 mem68k_fetch_video_byte(Uint32 addr) {
    //core_log("mem6k_fetch_video_byte %08x\n",addr);
    if (!(addr&0x1))
        return mem68k_fetch_video_word(addr)>>8;
    else {
        /* the odd byte is open bus: the low byte of the prefetched program word. gngeo indexed
         * &...p (the pointer variable) here, which read 4x past it and crashed (KOF2002). */
        Uint32 lpc=(cpu_68k_getpc()+2)&~1;
        Uint32 off=lpc&0xFFFFF;
        switch((lpc&0xF00000)>>20) {
        case 0x0:
            if (off < memory.rom.cpu_m68k.size)
                return READ_WORD_ROM(memory.rom.cpu_m68k.p+off);
            break;
        case 0x2:
            if (bankaddress+off < memory.rom.cpu_m68k.size)
                return READ_WORD_ROM(memory.rom.cpu_m68k.p+bankaddress+off);
            break;
        case 0xC:
            if (off < memory.rom.bios_m68k.size)
                return READ_WORD_ROM(memory.rom.bios_m68k.p+off);
            break;
        }
    }
    //	addr &= 0xFFFF;
    //	if (addr == 0xe)
    //		return 0xff;
    return 0xFF;
}

Uint16 mem68k_fetch_video_word(Uint32 addr) {
    //core_log("mem68k_fetch_video_word %08x\n",addr);
    addr &= 0x7;
    /*
      if (addr==0x00)
      return vptr;
    */
    if (addr == 0x00 || addr == 0x02 || addr == 0x0a)
        return memory.vid.rbuf;//READ_WORD(&memory.vid.ram[memory.vid.vptr << 1]);
    if (addr == 0x04)
        return memory.vid.modulo;
    if (addr == 0x06)
        return read_neo_control();
    return 0;
}
LONG_FETCH(mem68k_fetch_video)
;

/**** CONTROLLER ****/
Uint8 mem68k_fetch_ctl1_byte(Uint32 addr) {
    /* neo3ds: these ports are mirrored across 0x300000-0x31ffff (MAME mirror
     * 0x01ff7e): even = P1, odd = DIP switches, odd with A7 = system type. */
    if (!(addr & 1))
        return memory.intern_p1;
    if (addr & 0x80)
        return (conf.test_switch ? 0x00 : 0x80);
    return (conf.test_switch ? 0xFE : 0xFF);
}

Uint16 mem68k_fetch_ctl1_word(Uint32 addr) {
    /* neo3ds: gngeo returned 0 here, which reads as every DIP switch ON
     * (KOF98 then boots into its debug menu). Combine the two byte ports. */
    return (mem68k_fetch_ctl1_byte(addr & ~1) << 8) | mem68k_fetch_ctl1_byte(addr | 1);
}

Uint32 mem68k_fetch_ctl1_long(Uint32 addr) {
    return (mem68k_fetch_ctl1_word(addr) << 16) | mem68k_fetch_ctl1_word(addr + 2);
}

Uint8 mem68k_fetch_ctl2_byte(Uint32 addr) {
    /* mirrored like ctl1: even = P2, odd = unused (0xff) */
    return (addr & 1) ? 0xFF : memory.intern_p2;
}

Uint16 mem68k_fetch_ctl2_word(Uint32 addr) {
    /* neo3ds: gngeo returned 0 here, which reads as every DIP switch ON
     * (KOF98 then boots into its debug menu). Combine the two byte ports. */
    return (mem68k_fetch_ctl2_byte(addr & ~1) << 8) | mem68k_fetch_ctl2_byte(addr | 1);
}

Uint32 mem68k_fetch_ctl2_long(Uint32 addr) {
    return (mem68k_fetch_ctl2_word(addr) << 16) | mem68k_fetch_ctl2_word(addr + 2);
}

Uint8 mem68k_fetch_ctl3_byte(Uint32 addr) {
    /* 0x380000 (mirrored): even = start/select; odd reads as 0xff */
    return (addr & 1) ? 0xFF : memory.intern_start;
}

Uint16 mem68k_fetch_ctl3_word(Uint32 addr) {
    /* neo3ds: gngeo returned 0 here, which reads as every DIP switch ON
     * (KOF98 then boots into its debug menu). Combine the two byte ports. */
    return (mem68k_fetch_ctl3_byte(addr & ~1) << 8) | mem68k_fetch_ctl3_byte(addr | 1);
}

Uint32 mem68k_fetch_ctl3_long(Uint32 addr) {
    return (mem68k_fetch_ctl3_word(addr) << 16) | mem68k_fetch_ctl3_word(addr + 2);
}

Uint8 mem68k_fetch_coin_byte(Uint32 addr) {
    addr &= 0xFFFF;
    if (addr == 0x1) {
        int coinflip = read_4990_testbit();
        int databit = read_4990_databit();
        return memory.intern_coin ^ (coinflip << 6) ^ (databit << 7);
    }
    if (addr == 0x0) {
        int res = 0;
        if (conf.sound) {
            //core_log("fetch coin byte, rescoe= %x\n",result_code);
#ifdef ENABLE_940T

            res |= shared_ctl->result_code;
            if (shared_ctl->pending_command)
                res &= 0x7f;
#else
            res |= result_code;
            if (pending_command)
                res &= 0x7f;
#endif
        } else {
            res |= 0x01;
        }
        return res;
    }
    return 0;
}

Uint16 mem68k_fetch_coin_word(Uint32 addr) {
    /* neo3ds: gngeo returned 0 here, which reads as every DIP switch ON
     * (KOF98 then boots into its debug menu). Combine the two byte ports. */
    return (mem68k_fetch_coin_byte(addr & ~1) << 8) | mem68k_fetch_coin_byte(addr | 1);
}

Uint32 mem68k_fetch_coin_long(Uint32 addr) {
    return (mem68k_fetch_coin_word(addr) << 16) | mem68k_fetch_coin_word(addr + 2);
}

/**** MEMCARD ****/
/* Even byte are FF 
   Odd  byte are data;
*/
Uint8 mem68k_fetch_memcrd_byte(Uint32 addr) {
    addr &= 0xFFF;
    if (addr & 1)
        return 0xFF;
    else
        return memory.memcard[addr >> 1];
}

Uint16 mem68k_fetch_memcrd_word(Uint32 addr) {
    addr &= 0xFFF;
    return memory.memcard[addr >> 1] | 0xff00;
}

Uint32 mem68k_fetch_memcrd_long(Uint32 addr) {
    return 0;
}

/* storring function */
/**** INVALID STORE ****/
void mem68k_store_invalid_byte(Uint32 addr, Uint8 data) {
    if (addr != 0x300001)
        core_log("Invalid write b %x %x \n", addr, data);
    else {
        memory.watchdog = 0;
        //core_log("restet_watchdog\n");
    }
}
void mem68k_store_invalid_word(Uint32 addr, Uint16 data) {
    core_log("Invalid write w %x %x \n", addr, data);
}
void mem68k_store_invalid_long(Uint32 addr, Uint32 data) {
    core_log("Invalid write l %x %x \n", addr, data);
}

/**** RAM ****/
void mem68k_store_ram_byte(Uint32 addr, Uint8 data) {
    addr &= 0xffff;
    WRITE_BYTE_ROM(memory.ram + addr,data);
    return;
}

void mem68k_store_ram_word(Uint32 addr, Uint16 data) {
    //core_log("Store rom word %08x %04x\n",addr,data);
    addr &= 0xffff;
    WRITE_WORD_ROM(memory.ram + addr,data);
    return;
}

LONG_STORE(mem68k_store_ram)
;

/**** SRAM ****/
void mem68k_store_sram_byte(Uint32 addr, Uint8 data) {
    if (sram_lock)
        return;
    /*
      if (addr == 0xd00000 + sram_protection_hack && ((data & 0xff) == 0x01))
      return;
    */
    memory.sram[addr - 0xd00000] = data;
}

void mem68k_store_sram_word(Uint32 addr, Uint16 data) {
    if (sram_lock)
        return;
    /*
      if (addr == 0xd00000 + sram_protection_hack
      && ((data & 0xffff) == 0x01))
      return;
    */
    addr = (addr - 0xd00000) & 0xfffe;
    memory.sram[addr] = data >> 8;
    memory.sram[addr + 1] = data & 0xff;
}

LONG_STORE(mem68k_store_sram)
;

/**** PALETTE ****/
/*static __inline__ */Uint16 convert_pal(Uint16 npal) {
    int r = 0, g = 0, b = 0;
    r = ((npal >> 7) & 0x1e) | ((npal >> 14) & 0x01);
    g = ((npal >> 3) & 0x1e) | ((npal >> 13) & 0x01);
    b = ((npal << 1) & 0x1e) | ((npal >> 12) & 0x01);

    return (r << 11) + (g << 6) + b;
}

void update_all_pal(void) {
    int i;
    Uint32 *pc_pal1 = (Uint32*) memory.vid.pal_host[0];
    Uint32 *pc_pal2 = (Uint32*) memory.vid.pal_host[1];
    for (i = 0; i < 0x1000; i++) {
        //pc_pal1[i] = convert_pal(READ_WORD_ROM(&memory.pal1[i<<1]));
        //pc_pal2[i] = convert_pal(READ_WORD_ROM(&memory.pal2[i<<1]));
        pc_pal1[i] = convert_pal(READ_WORD(&memory.vid.pal_neo[0][i<<1]));
        pc_pal2[i] = convert_pal(READ_WORD(&memory.vid.pal_neo[1][i<<1]));
    }
}

void mem68k_store_pal_byte(Uint32 addr, Uint8 data) {
    /* TODO: verify this */
    addr &= 0xffff;
    if (addr <= 0x1fff) {
        Uint16 a = READ_WORD(&current_pal[addr & 0xfffe]);
        if (addr & 0x1)
            a = data | (a & 0xff00);
        else
            a = (a & 0xff) | (data << 8);
        WRITE_WORD(&current_pal[addr & 0xfffe], a);
        if ((addr >> 1) & 0xF)
            current_pc_pal[(addr) >> 1] = convert_pal(a);
        else
            current_pc_pal[(addr) >> 1] = 0xF81F;
    }
}

void mem68k_store_pal_word(Uint32 addr, Uint16 data) {
    //core_log("Store pal word @ %08x %08x %04x\n",cpu_68k_getpc(),addr,data);
    addr &= 0xffff;
    if (addr <= 0x1fff) {
        WRITE_WORD(&current_pal[addr], data);
        if ((addr >> 1) & 0xF)
            current_pc_pal[(addr) >> 1] = convert_pal(data);
        else
            current_pc_pal[(addr) >> 1] = 0xF81F;
    }
}

LONG_STORE(mem68k_store_pal)
;

/**** VIDEO ****/
void mem68k_store_video_byte(Uint32 addr, Uint8 data) {
    /* garou write at 3c001f, 3c000f, 3c0015 */
    /* wjammers write, and fetch at 3c0000 .... */
    //core_log("mem68k_store_video_byte %08x %02x @pc=%08x\n",addr,data,cpu_68k_getpc());
    if (!(addr&0x1)) {
        mem68k_store_video_word(addr,(data<<8)|data);
    }
}

void mem68k_store_video_word(Uint32 addr, Uint16 data) {
    //data&=0xFFFF;
    //core_log("mem68k_store_video_word %08x %04x @pc=%08x\n",addr,data,cpu_68k_getpc());
    addr &= 0xF;
    switch (addr) {
    case 0x0:
        memory.vid.vptr = data & 0xffff;
        memory.vid.rbuf = READ_WORD(&memory.vid.ram[memory.vid.vptr << 1]);
        break;
    case 0x2:
        //core_log("Store %04x to video %08x @pc=%08x\n",data,vptr<<1,cpu_68k_getpc());
        WRITE_WORD(&memory.vid.ram[memory.vid.vptr << 1], data);
        memory.vid.vptr = (memory.vid.vptr & 0x8000) + ((memory.vid.vptr
                                                         + memory.vid.modulo) & 0x7fff);
        memory.vid.rbuf = READ_WORD(&memory.vid.ram[memory.vid.vptr << 1]);
        break;
    case 0x4:
        if (data&0x4000)
            data|=0x8000;
        else
            data&=0x7FFF;

        memory.vid.modulo = (int) data;
        break;
    case 0x6:
        write_neo_control(data);
        break;
    case 0x8:
        write_irq2pos((memory.vid.irq2pos & 0xffff) | ((Uint32) data << 16));
        break;
    case 0xa:
        write_irq2pos((memory.vid.irq2pos & 0xffff0000) | (Uint32) data);
        break;
    case 0xc:
        /* games write 7 or 4 at 0x3c000c at every frame */
        /* IRQ acknowledge */
        break;
    }

}
LONG_STORE(mem68k_store_video)
;


/**** PD4990 ****/
void mem68k_store_pd4990_byte(Uint32 addr, Uint8 data) {
    write_4990_control_w(addr, data);
}

void mem68k_store_pd4990_word(Uint32 addr, Uint16 data) {
    write_4990_control_w(addr, data);
}

void mem68k_store_pd4990_long(Uint32 addr, Uint32 data) {
    write_4990_control_w(addr, data);
}

/**** Z80 ****/
void mem68k_store_z80_byte(Uint32 addr, Uint8 data) {
    if (addr == 0x320000) {
        sound_code = data & 0xff;
#ifdef NEO3DS_YMLOG
        { void ymlog_line(char, int, int); ymlog_line('C', 0, sound_code); }
#endif
        dbg_sound_cmds++;
        pending_command = 1;
        //core_log("B Pending command. Sound_code=%02x\n",sound_code);
        if (conf.sound) {
#ifdef ENABLE_940T
            //core_log("%d\n",shared_ctl->pending_command);
            shared_ctl->sound_code = sound_code;
            shared_ctl->pending_command = pending_command;
            //shared_ctl->pending_command=pending_command++;
            shared_ctl->nmi_pending = 1;

            if (conf.accurate940) {
                while (CHECK_BUSY(JOB940_RUN_Z80)
                       && shared_ctl->pending_command)
                    ;
                if (shared_ctl->nmi_pending) {
                    gp2x_add_job940(JOB940_RUN_Z80_NMI);
                    while (CHECK_BUSY(JOB940_RUN_Z80_NMI))
                        ;
                }
            }
#else
            cpu_z80_nmi();
            cpu_z80_run(300);
#endif
        }
    }
}
void mem68k_store_z80_word(Uint32 addr, Uint16 data) {
    /* tpgolf use word store for sound */
    if (addr == 0x320000) {
        sound_code = data >> 8;
#ifdef NEO3DS_YMLOG
        { void ymlog_line(char, int, int); ymlog_line('C', 0, sound_code); }
#endif
        dbg_sound_cmds++;
        pending_command = 1;
        //core_log("W Pending command. Sound_code=%02x\n",sound_code);
        if (conf.sound) {
#ifdef ENABLE_940T
            shared_ctl->sound_code = sound_code;
            shared_ctl->pending_command = pending_command;
            shared_ctl->nmi_pending = 1;
            if (conf.accurate940) {
                while (CHECK_BUSY(JOB940_RUN_Z80))
                    ;
                if (shared_ctl->nmi_pending) {
                    gp2x_add_job940(JOB940_RUN_Z80_NMI);
                    while (CHECK_BUSY(JOB940_RUN_Z80_NMI))
                        ;
                }
            }
#else
            cpu_z80_nmi();
            cpu_z80_run(300);
#endif
        }
    }
}
void mem68k_store_z80_long(Uint32 addr, Uint32 data) {
    /* I don't think any game will use long store for sound.... */
    core_log("Z80L %x %04x\n", addr, data);
}

/**** SETTINGS ****/
void mem68k_store_setting_byte(Uint32 addr, Uint8 data) {
    //core_log("mem68k_store_setting_byte %08x\n",addr);
    /* The registers decode A4-A1 only, so even and odd addresses (word writes) hit the same one. */
    addr = (addr & 0x1e) | 1;
    if (addr == 0x0003) {
        core_log("Selecting Bios Vector\n");
        memcpy(memory.rom.cpu_m68k.p, memory.rom.bios_m68k.p, 0x80);
        memory.current_vector=0;
    }

    if (addr == 0x0013) {
        core_log("Selecting Game Vector\n");
        memcpy(memory.rom.cpu_m68k.p, memory.game_vector, 0x80);
        memory.current_vector=1;
    }

    if (addr == 0x000b) { /* select board fix */
        if (!memory.rom.bios_sfix.p) return; /* AES: no board fix ROM, the cart's S ROM is always used */
        current_fix = memory.rom.bios_sfix.p;
        fix_usage = memory.fix_board_usage;
        memory.vid.currentfix=0;
        return;
    }
    if (addr == 0x001b) { /* select game fix */
        current_fix = memory.rom.game_sfix.p;
        fix_usage = memory.fix_game_usage;
        memory.vid.currentfix=1;
        return;
    }
    if (addr == 0x000d) { /* sram lock */
        sram_lock = 1;
        return;
    }
    if (addr == 0x001d) { /* sram unlock */
        sram_lock = 0;
        return;
    }
    if (addr == 0x000f) { /* set palette 2 */
        current_pal = memory.vid.pal_neo[1];
        current_pc_pal = (Uint32 *) memory.vid.pal_host[1];
        memory.vid.currentpal=1;
        return;
    }
    if (addr == 0x001f) { /* set palette 1 */
        current_pal = memory.vid.pal_neo[0];
        current_pc_pal = (Uint32 *) memory.vid.pal_host[0];
        memory.vid.currentpal = 0;
        return;
    }
    /* garou write 0 to 3a0001 -> enable display, 3a0011 -> disable display */
    //core_log("unknow mem68k_store_setting_byte %x %x\n",addr,data);

}

void mem68k_store_setting_word(Uint32 addr, Uint16 data) {
    /* TODO: Some game use it */
    // core_log("mem68k_store_setting_word USED????\n");
    mem68k_store_setting_byte(addr,data);
    return;
    addr &= 0xFFFFFe;
    if (addr == 0x3a0002) {
        memcpy(memory.rom.cpu_m68k.p, memory.rom.bios_m68k.p, 0x80);
    }

    if (addr == 0x3a0012) {
        memcpy(memory.rom.cpu_m68k.p, memory.game_vector, 0x80);
    }
    if (addr == 0x3a000a) {
        current_fix = memory.rom.bios_sfix.p;
        fix_usage = memory.fix_board_usage;
        return;
    }
    if (addr == 0x3a001a) {
        current_fix = memory.rom.game_sfix.p;
        fix_usage = memory.fix_game_usage;
        return;
    }
    if (addr == 0x3a000c) {
        sram_lock = 1;
        return;
    }
    if (addr == 0x3a001c) {
        sram_lock = 0;
        return;
    }
    if (addr == 0x3a000e) {
        current_pal = memory.vid.pal_neo[1];
        current_pc_pal = (Uint32 *) memory.vid.pal_host[1];
        return;
    }
    if (addr == 0x3a001e) {
        current_pal = memory.vid.pal_neo[0];
        current_pc_pal = (Uint32 *) memory.vid.pal_host[0];
        return;
    }
}

void mem68k_store_setting_long(Uint32 addr, Uint32 data) {
    mem68k_store_setting_byte(addr, data >> 16);
    mem68k_store_setting_byte(addr + 2, data);
}

/**** MEMCARD ****/
void mem68k_store_memcrd_byte(Uint32 addr, Uint8 data) {
    addr &= 0xFFF;
    memory.memcard[addr >> 1] = data;
}
void mem68k_store_memcrd_word(Uint32 addr, Uint16 data) {
    addr &= 0xFFF;
    memory.memcard[addr >> 1] = data & 0xff;
}
void mem68k_store_memcrd_long(Uint32 addr, Uint32 data) {
}

/**** bankswitchers ****/
static Uint16 neogeo_rng = 0x2345;

Uint16 sma_random(void) {
    Uint16 old = neogeo_rng;

    Uint16 newbit = ((neogeo_rng >> 2) ^ (neogeo_rng >> 3) ^ (neogeo_rng >> 5)
                     ^ (neogeo_rng >> 6) ^ (neogeo_rng >> 7) ^ (neogeo_rng >> 11)
                     ^ (neogeo_rng >> 12) ^ (neogeo_rng >> 15)) & 1;

    neogeo_rng = (neogeo_rng << 1) | newbit;

    return old;
}

/* PVC (MAME prot_pvc.cpp): 0x2fe000-0x2fffff is cart RAM. Writing a pen to word 0xff0 unpacks
 * it into 0xff1/0xff2, writing 0xff4/0xff5 packs them into 0xff6, and writing 0xff8 and up
 * selects the ROM bank given by bytes 0x1ff1-0x1ff3. */
Uint16 pvc_ram[0x1000];

static void pvc_write(Uint32 addr, Uint16 data, Uint16 mask) {
    Uint32 o = (addr & 0x1fff) >> 1;
    pvc_ram[o] = (pvc_ram[o] & ~mask) | (data & mask);
    if (o == 0xff0) {
        Uint16 pen = pvc_ram[0xff0];
        Uint8 b = ((pen & 0x000f) << 1) | ((pen & 0x1000) >> 12);
        Uint8 g = ((pen & 0x00f0) >> 3) | ((pen & 0x2000) >> 13);
        Uint8 r = ((pen & 0x0f00) >> 7) | ((pen & 0x4000) >> 14);
        Uint8 s = (pen & 0x8000) >> 15;
        pvc_ram[0xff1] = (g << 8) | b;
        pvc_ram[0xff2] = (s << 8) | r;
    } else if (o == 0xff4 || o == 0xff5) {
        Uint16 gb = pvc_ram[0xff4], sr = pvc_ram[0xff5];
        pvc_ram[0xff6] = ((gb & 0x001e) >> 1) | ((gb & 0x1e00) >> 5) | ((sr & 0x001e) << 7) |
            ((gb & 0x0001) << 12) | ((gb & 0x0100) << 5) | ((sr & 0x0001) << 14) | ((sr & 0x0100) << 7);
    } else if (o >= 0xff8) {
        Uint32 bank = ((pvc_ram[0xff8] >> 8) | (pvc_ram[0xff9] << 8)) + 0x100000;
        pvc_ram[0xff8] = (pvc_ram[0xff8] & 0xfe00) | 0x00a0;
        pvc_ram[0xff9] &= 0x7fff;
        if (bank + 0x100000 > memory.rom.cpu_m68k.size) bank = 0x100000;
        cpu_68k_bankswitch(bank & ~1);
    }
}

/* Normal bankswitcher */
Uint8 mem68k_fetch_bk_normal_byte(Uint32 addr) {
    if (memory.pvc && (addr & 0xFFFFF) >= 0xfe000) {
        Uint16 w = pvc_ram[(addr & 0x1fff) >> 1];
        return addr & 1 ? w & 0xff : w >> 8;
    }
    if (memory.bksw_unscramble) { /* SMA prot & random number generator */
        Uint32 a=addr&0xFFFFE;
        if (a == 0xfe446) {
            //core_log("Prot reading B %08x\n", addr);
            return (addr&0x1?0x9a:0x37);
        }
        if (memory.sma_rng_addr && addr>=0x2fff00 &&
            (((a & 0xFF) == (memory.sma_rng_addr & 0xFF)) || 
             ((a & 0xFF) == memory.sma_rng_addr >> 8))) {
            //core_log("SMA_Random B %08x\n",addr);
            return (addr&0x1?sma_random()>>8:sma_random()&0xFF);
        }
    }
    addr &= 0xFFFFF;
    return (READ_BYTE_ROM(memory.rom.cpu_m68k.p + bankaddress + addr));
}

Uint16 mem68k_fetch_bk_normal_word(Uint32 addr) {
    if (memory.pvc && (addr & 0xFFFFF) >= 0xfe000)
        return pvc_ram[(addr & 0x1fff) >> 1];
    if (memory.bksw_unscramble) { /* SMA prot & random number generator */
      if ((addr&0xFFFFF) == 0xfe446) {
            //core_log("Prot reading W %08x\n", addr);
            return 0x9a37;
        }
        if (memory.sma_rng_addr && addr>=0x2fff00 &&
            (((addr & 0xFF) == (memory.sma_rng_addr & 0xFF)) || 
             ((addr & 0xFF) == memory.sma_rng_addr >> 8))) {
            //core_log("SMA_Random W %08x\n",addr);
            return sma_random();
        }
    }
    addr &= 0xFFFFF;
    return (READ_WORD_ROM(memory.rom.cpu_m68k.p + bankaddress + addr));
}

LONG_FETCH(mem68k_fetch_bk_normal)
;

static void bankswitch(Uint32 address, Uint8 data) {

    if (memory.rom.cpu_m68k.size <= 0x100000)
        return;

    if (address >= 0x2FFFF0) {
        data = data & 0x7;
        bankaddress = (data + 1) * 0x100000;
    } else
        return;

    if (bankaddress >= memory.rom.cpu_m68k.size)
        bankaddress = 0x100000;
    cpu_68k_bankswitch(bankaddress);
}

void mem68k_store_bk_normal_byte(Uint32 addr, Uint8 data) {
    //if (addr<0x2FFFF0)
    //core_log("bankswitch_b %x %x\n", addr, data);
    if (memory.pvc) {
        if ((addr & 0xFFFFF) >= 0xfe000)
            pvc_write(addr, addr & 1 ? data : data << 8, addr & 1 ? 0x00ff : 0xff00);
        return;
    }
    bankswitch(addr, data);
}

void mem68k_store_bk_normal_word(Uint32 addr, Uint16 data) {
    //if (addr<0x2FFFF0) 
    //core_log("bankswitch_w %x %x\n",addr,data);
    if (memory.pvc) {
        if ((addr & 0xFFFFF) >= 0xfe000) pvc_write(addr, data, 0xffff);
        return;
    }
    if (memory.bksw_unscramble &&(addr & 0xFF) == memory.bksw_unscramble[0]) {
        /* unscramble bank number */
        data = 
            (((data >> memory.bksw_unscramble[1]) & 1) << 0) + 
            (((data	>> memory.bksw_unscramble[2]) & 1) << 1) + 
            (((data	>> memory.bksw_unscramble[3]) & 1) << 2) + 
            (((data	>> memory.bksw_unscramble[4]) & 1) << 3) + 
            (((data	>> memory.bksw_unscramble[5]) & 1) << 4) + 
            (((data	>> memory.bksw_unscramble[6]) & 1) << 5);

        bankaddress = 0x100000 + memory.bksw_offset[data];
        cpu_68k_bankswitch(bankaddress);
    } else
        bankswitch(addr, data);
}

LONG_STORE(mem68k_store_bk_normal)
;

/* neo3ds: save states (savestate.c) */
void memory_state(void) {
    st_bytes(memory.ram, sizeof memory.ram);
    st_bytes(&memory.vid, offsetof(VIDEO, spr_cache)); /* the sprite cache only holds decompressed ROM */
    st_bytes(memory.sram, sizeof memory.sram);
    st_bytes(memory.z80_ram, sizeof memory.z80_ram);
    st_bytes(&memory.current_vector, sizeof memory.current_vector);
    st_bytes(memory.rom.cpu_m68k.p, 0x80); /* the vectors in place: the BIOS's or the game's */
    st_bytes(&memory.sma_rng_addr, sizeof memory.sma_rng_addr);
    st_bytes(memory.memcard, sizeof memory.memcard);
    st_bytes(&memory.watchdog, sizeof memory.watchdog);
    st_bytes(&sram_lock, 1);
    st_bytes(&sound_code, 1);
    st_bytes(&pending_command, 1);
    st_bytes(&result_code, 1);
    st_bytes(z80_bank, sizeof z80_bank);
    st_bytes(&bankaddress, sizeof bankaddress);
    st_bytes(&neogeo_rng, sizeof neogeo_rng);
    st_bytes(pvc_ram, sizeof pvc_ram);
    if (!st_reading()) return;
    current_pal = memory.vid.pal_neo[memory.vid.currentpal & 1];
    current_pc_pal = (Uint32 *) memory.vid.pal_host[memory.vid.currentpal & 1];
    if (memory.vid.currentfix == 0 && memory.rom.bios_sfix.p) {
        current_fix = memory.rom.bios_sfix.p;
        fix_usage = memory.fix_board_usage;
    } else {
        current_fix = memory.rom.game_sfix.p;
        fix_usage = memory.fix_game_usage;
        memory.vid.currentfix = 1;
    }
}
