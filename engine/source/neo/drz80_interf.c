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

#ifdef USE_DRZ80
#include "emu.h"
#include "memory.h"
#include "drz80/DrZ80.h"
#include "state.h"
#ifdef GP2X
#include "ym2610-940/940shared.h"
#endif

#ifndef ENABLE_940T

static Uint8 *z80map1, *z80map2, *z80map3, *z80map4;
Uint8 drz80mem[0x10000];
Uint32 mydrz80_Z80PC,mydrz80_Z80SP;

struct DrZ80 mydrz80;
static int nmi_enabled, nmi_pending; /* see cpu_z80_nmi */
int z80_port_writes, z80_port_reads; /* neo3ds diagnostics */
//extern Z80_Regs Z80;

Uint16 dbg_z80_jumps[8]; /* neo3ds diagnostics: last rebased PCs */
int dbg_z80_jump_pos, dbg_z80_resets;

unsigned int drz80_rebasePC(unsigned int address)
{
	address &= 0xFFFF;
	//if (address==0x66)
	core_log("Rebase PC %x\n",address);
	if (address == 0) dbg_z80_resets++;
	else if (address != dbg_z80_jumps[(dbg_z80_jump_pos - 1) & 7]) {
		dbg_z80_jumps[dbg_z80_jump_pos & 7] = address;
		dbg_z80_jump_pos++;
	}
        mydrz80.Z80PC_BASE = (unsigned int)drz80mem;
	mydrz80.Z80PC = mydrz80.Z80PC_BASE + address;
        return mydrz80.Z80PC_BASE + address;
}

unsigned int drz80_rebaseSP(unsigned int address)
{
	address &= 0xFFFF;
	core_log("Rebase SP %x\n",address);
        mydrz80.Z80SP_BASE = (unsigned int)drz80mem;
	mydrz80.Z80SP = mydrz80.Z80SP_BASE + address;
	return mydrz80.Z80SP_BASE + address;
}

/* DrZ80 calls these from asm with unnarrowed registers: take full registers and mask here. */
unsigned char drz80_read8(unsigned int address) {
        return (drz80mem[address&0xFFFF]);
}

unsigned short drz80_read16(unsigned int address) {
        return drz80_read8(address & 0xFFFF) | (drz80_read8((address + 1) & 0xFFFF) << 8);
}

void drz80_write8(unsigned int data,unsigned int address) {
        address &= 0xFFFF;
        if (address>=0xf800) drz80mem[address]=data & 0xFF;
}

void drz80_write16(unsigned int data,unsigned int address) {
        drz80_write8(data & 0xFF,address);
        drz80_write8((data >> 8) & 0xFF,address + 1);
}

void drz80_writeport16(unsigned int port, unsigned int value)
{
	core_log("Write port %d=%d\n",port,value);
	z80_port_writes++;
    z80_port_write(port & 0xFFFF, value & 0xFF);
}

Uint8 drz80_readport16(unsigned int port)
{
	core_log("Read port %d\n",port);
	z80_port_reads++;
#ifdef NEO3DS_YMLOG
	{
		void ymlog_line(char, int, int);
		Uint8 v = z80_port_read(port & 0xFFFF);
		ymlog_line('R', port & 0xFFFF, v);
		return v;
	}
#endif
    return z80_port_read(port & 0xFFFF);
}

/* cpu interface implementation */
int z80_bank_wraps; /* neo3ds diagnostics: bank selects past the end of the M1 ROM */

/* Start of the M1 ROM data for a bank select, as MAME's audio_cpu_banking_init: bank numbers
 * wrap at the ROM size (small ROMs mirror) and never reach past 256KB. gngeo used fixed masks,
 * so a 128KB ROM selecting a mirrored bank read whatever lay after the ROM. */
static Uint8 *z80_bank_base(Uint16 PortNo, int shift) {
	Uint32 mask = (memory.rom.cpu_z80.size - 1) & 0x3ffff;
	Uint32 offset = ((Uint32)(PortNo >> 8) << shift);
	if (offset & ~mask) z80_bank_wraps++;
	return memory.rom.cpu_z80.p + (offset & mask);
}

/* cpu interface implementation */
void cpu_z80_switchbank(Uint8 bank, Uint16 PortNo)
{
	core_log("Switch bank %x %x\n",bank,PortNo);
    if (bank<=3)
	z80_bank[bank]=PortNo;

    switch (bank) {
    case 0:
	z80map1 = z80_bank_base(PortNo, 14);
	memcpy(drz80mem + 0x8000, z80map1, 0x4000);
	break;
    case 1:
	z80map2 = z80_bank_base(PortNo, 13);
	memcpy(drz80mem + 0xc000, z80map2, 0x2000);
	break;
    case 2:
	z80map3 = z80_bank_base(PortNo, 12);
	memcpy(drz80mem + 0xe000, z80map3, 0x1000);
	break;
    case 3:
	z80map4 = z80_bank_base(PortNo, 11);
	memcpy(drz80mem + 0xf000, z80map4, 0x0800);
	break;
    }
}

void drz80_irq_callback(void)
{
        //if (mydrz80.Z80_IRQ ==0x2) 
	//mydrz80.Z80_IRQ = 0x00;
	//core_log("Irq have been accepted %x %x\n",mydrz80.Z80_IRQ,mydrz80.Z80IF);
}

#if 0 /* neo3ds: disabled */
void cpu_z80_mkstate(gzFile gzf,int mode) {
	/* TODO */
}
#endif

void cpu_z80_init(void)
{
        memset (&mydrz80, 0, sizeof(mydrz80));
        nmi_enabled = nmi_pending = 0;
        mydrz80.z80_rebasePC=drz80_rebasePC;
        mydrz80.z80_rebaseSP=drz80_rebaseSP;
        mydrz80.z80_read8   =drz80_read8;
        mydrz80.z80_read16  =drz80_read16;
        mydrz80.z80_write8  =drz80_write8;
        mydrz80.z80_write16 =drz80_write16;
        mydrz80.z80_in      =drz80_readport16; /*z80_in*/
        mydrz80.z80_out     =drz80_writeport16; /*z80_out*/
        //mydrz80.z80_irq_callback=drz80_irq_callback;
        //mydrz80.Z80A = 0x00 <<24;
        mydrz80.Z80F = (1<<2); /* set ZFlag */
        //mydrz80.Z80BC = 0x0000 <<16;
        //mydrz80.Z80DE = 0x0000 <<16;
        //mydrz80.Z80HL = 0x0000 <<16;
        //mydrz80.Z80A2 = 0x00 <<24;
        mydrz80.Z80F2 = 1<<2;  /* set ZFlag */
        //mydrz80.Z80BC2 = 0x0000 <<16;
        //mydrz80.Z80DE2 = 0x0000 <<16;
        //mydrz80.Z80HL2 = 0x0000 <<16;
        mydrz80.Z80IX = 0xFFFF;// <<16;
        mydrz80.Z80IY = 0xFFFF;// <<16;
        mydrz80.Z80I = 0x00;
        mydrz80.Z80IM = 0x01;
        mydrz80.Z80_IRQ = 0x00;
        mydrz80.Z80IF = 0x00;
        mydrz80.Z80PC=mydrz80.z80_rebasePC(0);
        /* neo3ds: DrZ80 is built with GNGEO_OPTIM, whose "ld sp,nn" adds Z80SP_BASE
         * directly instead of calling z80_rebaseSP. Without this the Z80 stack
         * pointed at host address 0x0000xxxx and every RET jumped to garbage. */
        mydrz80.Z80SP=mydrz80.z80_rebaseSP(0xffff);

/* bank initalisation */
	z80map1 = memory.rom.cpu_z80.p + 0x8000;
	z80map2 = memory.rom.cpu_z80.p + 0xc000;
	z80map3 = memory.rom.cpu_z80.p + 0xe000;
	z80map4 = memory.rom.cpu_z80.p + 0xf000;
	
	z80_bank[0]=0x8000;
	z80_bank[1]=0xc000;
	z80_bank[2]=0xe000;
	z80_bank[3]=0xf000;
	
	memcpy(drz80mem, memory.rom.cpu_z80.p, 0xf800);
	//z80_init_save_state();
}
Uint16 dbg_z80_restart_from[4]; /* neo3ds diagnostics: PC seen just before falling back to boot code */
int dbg_z80_restarts;

/* Idle loop skip. Some sound drivers (Metal Slug 2, X and 3) wait for their timer interrupt in
 *     s:   ld a,(hl)       7 cycles
 *     s+1: and a / or a    4
 *     s+2: jp z,s          10
 * polling a byte that only the interrupt handler changes, and spend about half the Z80's time
 * there. Interrupts arrive between slices, so a slice that starts in that loop with the byte
 * still 0 and no interrupt pending only goes round the loop. Instead of running it, this works
 * out where DrZ80 would stop (it runs instructions while the cycle count stays >= 0) and sets
 * PC, A and F to what the loop leaves there: the same state, so the sound is unchanged.
 * The loop is found by its bytes, so no per-game addresses are needed. */
unsigned z80_idle_slices; /* diagnostics: slices skipped */

static int z80_idle(int nbcycle) {
	const int pc = mydrz80.Z80PC - mydrz80.Z80PC_BASE;
	if (mydrz80.Z80_IRQ) return 0;
	for (int s = pc; s >= 0 && s >= pc - 2; s--) { /* the slice may have stopped on any of the three */
		const Uint8 *m = drz80mem + s;
		if (s > 0xfffb) continue;
		if (!(m[0] == 0x7e && (m[1] == 0xa7 || m[1] == 0xb7) && m[2] == 0xca && (m[3] | m[4] << 8) == s)) continue;
		if (drz80mem[mydrz80.Z80HL >> 16]) return 0; /* the loop is about to end */
		int p = pc - s, c = nbcycle;
		if (p == 1 && (mydrz80.Z80A >> 24)) return 0;
		if (p == 2 && !(mydrz80.Z80F & (1 << 2))) return 0; /* jp z falls through */
		/* DrZ80 flags for and a / or a with A = 0: Z and P/V (its PZS table), and a also sets H */
		const unsigned f = m[1] == 0xa7 ? 0x15 : 0x05;
		do {
			if (p == 0) mydrz80.Z80A = 0, c -= 7;
			else if (p == 1) mydrz80.Z80F = f, c -= 4;
			else c -= 10;
			p = p == 2 ? 0 : p + 1;
		} while (c >= 0);
		mydrz80.Z80PC = mydrz80.Z80PC_BASE + s + p;
		return 1;
	}
	return 0;
}

void cpu_z80_run(int nbcycle) {
	static Uint16 last_pc;
	Uint16 pc;
	//core_log("Drz80run %d\n",nbcycle);
	if (z80_idle(nbcycle)) {
		z80_idle_slices++;
		return;
	}
	DrZ80Run(&mydrz80, nbcycle);
	pc = mydrz80.Z80PC - mydrz80.Z80PC_BASE;
	/* entering the boot/init code (0x00b0-0x00c7) from anywhere else */
	if (pc >= 0xb0 && pc < 0xc8 && !(last_pc >= 0xb0 && last_pc < 0xc8))
		dbg_z80_restart_from[dbg_z80_restarts++ & 3] = last_pc;
	last_pc = pc;
}
/*
#define PUSH_PC() { mydrz80.Z80SP-=2; mydrz80.z80_write16(mydrz80.Z80PC - mydrz80.Z80PC_BASE,mydrz80.Z80SP); }
*/

/* The NMI is only delivered while the Z80 has enabled it (port 0x08, disabled
 * by 0x18). A command written while disabled stays pending until enabled or
 * until the Z80 reads it from port 0x00, as on hardware (and MAME). */

void cpu_z80_nmi(void)
{
	nmi_pending = 1;
	if (nmi_enabled)
		mydrz80.Z80_IRQ |= 0x02;
}

void cpu_z80_set_nmi_enable(int enable)
{
	nmi_enabled = enable;
	if (enable && nmi_pending)
		mydrz80.Z80_IRQ |= 0x02;
}

void cpu_z80_ack_command(void)
{
	nmi_pending = 0;
}

void cpu_z80_raise_irq(int l)
{
	//core_log("raise irq %x %x\n",mydrz80.Z80_IRQ,mydrz80.Z80IF);
	mydrz80.Z80_IRQ |= 0x1;
	//mydrz80.z80irqvector= l & 0xff;
}
void cpu_z80_lower_irq(void)
{
	//core_log("Lower irq %x %x\n",mydrz80.Z80_IRQ,mydrz80.Z80IF);
	mydrz80.Z80_IRQ &= ~0x1;
}
#endif /* ENABLE_940T */
#endif
