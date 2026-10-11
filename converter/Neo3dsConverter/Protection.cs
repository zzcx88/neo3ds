// Ported from MAME src/devices/bus/neogeo (prot_cmc, prot_sma, prot_pcm2, prot_kof2k2, sma, cmc,
// pcm2, kof2k2), BSD-3-Clause, copyright-holders: S. Smith, David Haywood, Fabio Priuli,
// Razoola, Mr.K, and the decode information credited there.
namespace Neo3dsConverter;

/// <summary>
/// Undoes a cart's encryption once at conversion time, as MAME's decrypt_all does when it loads
/// the cart. Regions use the engine's layout: maincpu as 16-bit little-endian words.
/// </summary>
public static class Protection
{
    /// <summary>Cart types whose ROMs this converter decrypts. "rom" is a plain cart.</summary>
    public static bool Supported(string cart) => cart switch
    {
        "rom" or "rom_mslugx" => true,
        _ when cart.StartsWith("cmc42_") || cart is "cmc50_kof2001" or "cmc50_kof2000n" => true,
        _ when cart.StartsWith("sma_") || cart.StartsWith("pcm2_") || cart.StartsWith("k2k2_") => true,
        _ => false,
    };

    /// <summary>How the cart banks a fix ROM past 128KB (MAME get_fixed_bank_type): 0 none,
    /// 1 Garou / Metal Slug 3 type, 2 KOF2000 type.</summary>
    public static int FixBankType(string cart) => cart switch
    {
        "cmc50_kof2000n" or "sma_kof2k" or "k2k2_matrim" => 2,
        "pcm2_ms4p" or "k2k2_kof2k2" or "k2k2_kf2k2p" => 0,
        _ when cart.StartsWith("cmc42_") || cart.StartsWith("cmc50_") || cart.StartsWith("sma_") ||
               cart.StartsWith("pcm2_") || cart.StartsWith("k2k2_") => 1,
        _ => 0,
    };

    /// <summary>Decrypts the regions in place. Returns what the engine must emulate while the
    /// game runs (SMA bank switching), or null.</summary>
    public static SmaConfig? Apply(string cart, Dictionary<string, byte[]> r)
    {
        byte[] spr = r["sprites"];
        void Fix() => Cmc.SfixDecrypt(spr, r["fixed"]);
        void M1() => r["m1"] = Cmc.M1Decrypt(r["audiocrypt"]);
        void Cmc42(int key) { Cmc.GfxDecrypt(spr, key, cmc50: false); Fix(); }
        void Cmc50(int key, bool fix = true) { M1(); Cmc.GfxDecrypt(spr, key, cmc50: true); if (fix) Fix(); }

        switch (cart)
        {
            case "cmc42_kof99k": Cmc42(0x00); break;
            case "cmc42_mslug3h": Cmc42(0xad); break;
            case "cmc42_zupapa": Cmc42(0xbd); break;
            case "cmc42_ganryu": Cmc42(0x07); break;
            case "cmc42_s1945p": Cmc42(0x05); break;
            case "cmc42_preisle2": Cmc42(0x9f); break;
            case "cmc42_bangbead": Cmc42(0xf8); break;
            case "cmc42_nitd": Cmc42(0xff); break;
            case "cmc42_sengoku3": Cmc42(0xfe); break;
            case "cmc50_kof2001": Cmc50(0x1e); break;
            case "cmc50_kof2000n": Cmc50(0x00); break;

            case "sma_kof99": Sma.Kof99(r["maincpu"]); Cmc42(0x00); return Sma.Kof99Config;
            case "sma_garou": Sma.Garou(r["maincpu"]); Cmc42(0x06); return Sma.GarouConfig;
            case "sma_garouh": Sma.Garouh(r["maincpu"]); Cmc42(0x06); return Sma.GarouhConfig;
            case "sma_mslug3": Sma.Mslug3(r["maincpu"]); Cmc42(0xad); return Sma.Mslug3Config;
            case "sma_mslug3a": Sma.Mslug3a(r["maincpu"]); Cmc42(0xad); return Sma.Mslug3aConfig;
            case "sma_kof2k": Sma.Kof2000(r["maincpu"]); Cmc50(0x00); return Sma.Kof2000Config;

            case "pcm2_mslug4": Cmc50(0x31); Pcm2.Decrypt(r["ymsnd:adpcma"], 8); break;
            case "pcm2_ms4p": Cmc50(0x31, fix: false); Pcm2.Decrypt(r["ymsnd:adpcma"], 8); break;
            case "pcm2_rotd": Cmc50(0x3f); Pcm2.Decrypt(r["ymsnd:adpcma"], 16); break;
            case "pcm2_pnyaa": Cmc50(0x2e); Pcm2.Decrypt(r["ymsnd:adpcma"], 4); break;

            case "k2k2_kof2k2": Kof2002.Program(r["maincpu"]); Cmc50(0xec); Pcm2.Swap(r["ymsnd:adpcma"], 0); break;
            case "k2k2_kf2k2p": Kof2002.Program(r["maincpu"]); Cmc50(0xec, fix: false); Pcm2.Swap(r["ymsnd:adpcma"], 0); break;
            case "k2k2_matrim": Kof2002.Program(r["maincpu"]); Cmc50(0x6a); Pcm2.Swap(r["ymsnd:adpcma"], 1); break;
            case "k2k2_samsh5": Kof2002.Samsho5(r["maincpu"]); Cmc50(0x0f); Pcm2.Swap(r["ymsnd:adpcma"], 4); break;
            case "k2k2_sams5s": Kof2002.Samsh5sp(r["maincpu"]); Cmc50(0x0d); Pcm2.Swap(r["ymsnd:adpcma"], 6); break;
        }
        return null;
    }

    /// <summary>MAME bitswap&lt;n&gt;: bits lists the source bit for each result bit, most significant first.</summary>
    internal static int BitSwap(int value, params int[] bits)
    {
        int r = 0;
        foreach (int b in bits) r = r << 1 | (value >> b & 1);
        return r;
    }

    internal static ushort Word(byte[] p, int i) => (ushort)(p[2 * i] | p[2 * i + 1] << 8);
    internal static void SetWord(byte[] p, int i, int w) { p[2 * i] = (byte)w; p[2 * i + 1] = (byte)(w >> 8); }
}

/// <summary>NEO-CMC42 / CMC50: sprite (C ROM) encryption, fix layer stored at the end of the sprites,
/// and on CMC50 the Z80 (M1) ROM.</summary>
static partial class Cmc
{
    public static void GfxDecrypt(byte[] rom, int extraXor, bool cmc50)
    {
        var t03 = cmc50 ? Kof2000Type0T03 : Kof99Type0T03;
        var t12 = cmc50 ? Kof2000Type0T12 : Kof99Type0T12;
        var u03 = cmc50 ? Kof2000Type1T03 : Kof99Type1T03;
        var u12 = cmc50 ? Kof2000Type1T12 : Kof99Type1T12;
        var a815x1 = cmc50 ? Kof2000Address815Xor1 : Kof99Address815Xor1;
        var a815x2 = cmc50 ? Kof2000Address815Xor2 : Kof99Address815Xor2;
        var a1623x1 = cmc50 ? Kof2000Address1623Xor1 : Kof99Address1623Xor1;
        var a1623x2 = cmc50 ? Kof2000Address1623Xor2 : Kof99Address1623Xor2;
        var a07 = cmc50 ? Kof2000Address07Xor : Kof99Address07Xor;

        int words = rom.Length / 4;
        var buf = new byte[rom.Length];

        // Data xor: bytes 0&3 and 1&2 of each longword, keyed by the (encrypted) address.
        Parallel.For(0, words, rpos =>
        {
            Decrypt(buf, 4 * rpos + 0, 4 * rpos + 3, rom[4 * rpos + 0], rom[4 * rpos + 3], t03, t12, u03, a07, rpos,
                    (rpos >> 8) & 1);
            Decrypt(buf, 4 * rpos + 1, 4 * rpos + 2, rom[4 * rpos + 1], rom[4 * rpos + 2], t12, t03, u12, a07, rpos,
                    ((rpos >> 16) ^ a1623x2[(rpos >> 8) & 0xff]) & 1);
        });

        // Address xor
        Parallel.For(0, words, rpos =>
        {
            int baser = rpos ^ extraXor;
            baser ^= a815x1[(baser >> 16) & 0xff] << 8;
            baser ^= a815x2[baser & 0xff] << 8;
            baser ^= a1623x1[baser & 0xff] << 16;
            baser ^= a1623x2[(baser >> 8) & 0xff] << 16;
            baser ^= a07[(baser >> 8) & 0xff];

            if (rom.Length == 0x3000000) // preisle2
                baser = rpos < 0x2000000 / 4 ? baser & (0x2000000 / 4 - 1) : 0x2000000 / 4 + (baser & (0x1000000 / 4 - 1));
            else if (rom.Length == 0x6000000) // kf2k3pcb
                baser = rpos < 0x4000000 / 4 ? baser & (0x4000000 / 4 - 1) : 0x4000000 / 4 + (baser & (0x1000000 / 4 - 1));
            else
                baser &= words - 1;

            rom[4 * rpos + 0] = buf[4 * baser + 0];
            rom[4 * rpos + 1] = buf[4 * baser + 1];
            rom[4 * rpos + 2] = buf[4 * baser + 2];
            rom[4 * rpos + 3] = buf[4 * baser + 3];
        });
    }

    static void Decrypt(byte[] buf, int i0, int i1, byte c0, byte c1, byte[] table0hi, byte[] table0lo, byte[] table1,
                        byte[] a07, int b, int invert)
    {
        byte tmp = table1[(b & 0xff) ^ a07[(b >> 8) & 0xff]];
        byte xor0 = (byte)((table0hi[(b >> 8) & 0xff] & 0xfe) | (tmp & 0x01));
        byte xor1 = (byte)((tmp & 0xfe) | (table0lo[(b >> 8) & 0xff] & 0x01));
        if (invert != 0) { buf[i0] = (byte)(c1 ^ xor0); buf[i1] = (byte)(c0 ^ xor1); }
        else { buf[i0] = (byte)(c0 ^ xor0); buf[i1] = (byte)(c1 ^ xor1); }
    }

    /// <summary>The fix layer (S data) is the end of the decrypted sprite data, in a different order.</summary>
    public static void SfixDecrypt(byte[] rom, byte[] fix)
    {
        int src = rom.Length - fix.Length;
        for (int i = 0; i < fix.Length; i++)
            fix[i] = rom[src + (i & ~0x1f) + ((i & 7) << 2) + ((~i & 8) >> 2) + ((i & 0x10) >> 4)];
    }

    static readonly int[,] M1Perm =
    {
        {15,14,10,7,1,2,3,8,0,12,11,13,6,9,5,4},
        {7,1,8,11,15,9,2,3,5,13,4,14,10,0,6,12},
        {8,6,14,3,10,7,15,1,4,0,2,5,13,11,12,9},
        {2,8,15,9,3,4,11,7,13,6,0,10,1,12,14,5},
        {1,13,6,15,14,3,8,10,9,4,7,12,5,2,0,11},
        {11,15,3,4,7,0,9,2,6,14,12,1,8,5,10,13},
        {10,5,13,8,6,15,1,14,11,9,3,0,12,7,4,2},
        {9,3,7,0,2,12,4,11,14,10,5,8,15,13,1,6},
    };

    static int M1AddressScramble(int address, int key)
    {
        int block = (address >> 16) & 7;
        int aux = address & 0xffff;
        aux ^= Protection.BitSwap(key, 12, 0, 2, 4, 8, 15, 7, 13, 10, 1, 3, 6, 11, 9, 14, 5);
        var p = new int[16];
        for (int i = 0; i < 16; i++) p[i] = M1Perm[block, 15 - i];
        aux = Protection.BitSwap(aux, p);
        aux ^= M1Address07Xor[(aux >> 8) & 0xff];
        aux ^= M1Address815Xor[aux & 0xff] << 8;
        aux = Protection.BitSwap(aux, 7, 15, 14, 6, 5, 13, 12, 4, 11, 3, 10, 2, 9, 1, 8, 0);
        return (block << 16) | aux;
    }

    /// <summary>CMC50 Z80 ROM: the key is the 16-bit byte sum of its first 64KB. Returns the 512KB decrypted ROM.</summary>
    public static byte[] M1Decrypt(byte[] crypt)
    {
        const int size = 0x80000;
        int key = 0;
        for (int i = 0; i < 0x10000; i++) key += crypt[i];
        key &= 0xffff;
        var rom = new byte[size];
        for (int i = 0; i < size; i++) rom[i] = crypt[M1AddressScramble(i, key)];
        return rom;
    }
}

/// <summary>What the engine needs to run an SMA cart: where the game writes its bank number,
/// how that number's bits are scrambled, the bank start offsets, and where the random numbers are read.</summary>
public sealed record SmaConfig(int BankAddr, int[] Bits, int[] Offsets, int RngAddr1, int RngAddr2);

/// <summary>NEO-SMA: 68k program encryption plus bank switching and a random number generator.</summary>
static class Sma
{
    static void DataSwap(byte[] p, params int[] bits)
    {
        Parallel.For(0, 0x800000 / 2, i =>
        {
            int a = 0x100000 / 2 + i;
            Protection.SetWord(p, a, Protection.BitSwap(Protection.Word(p, a), bits));
        });
    }

    /// <summary>Reorders words inside each block of the banked part (from 0x100000).</summary>
    static void BankedSwap(byte[] p, int length, int block, params int[] bits)
    {
        var buffer = new byte[block];
        for (int i = 0; i < length; i += block)
        {
            int at = 0x100000 + i;
            Array.Copy(p, at, buffer, 0, block);
            for (int j = 0; j < block / 2; j++)
            {
                int src = Protection.BitSwap(j, bits);
                p[at + 2 * j] = buffer[2 * src];
                p[at + 2 * j + 1] = buffer[2 * src + 1];
            }
        }
    }

    /// <summary>The fixed part (0-0xbffff) is a scrambled copy of the given area.</summary>
    static void RelocateFixed(byte[] p, int from, params int[] bits)
    {
        for (int i = 0; i < 0x0c0000 / 2; i++)
            Protection.SetWord(p, i, Protection.Word(p, from / 2 + Protection.BitSwap(i, bits)));
    }

    public static void Kof99(byte[] p)
    {
        DataSwap(p, 13, 7, 3, 0, 9, 4, 5, 6, 1, 12, 8, 14, 10, 11, 2, 15);
        BankedSwap(p, 0x600000, 0x800, 6, 2, 4, 9, 8, 3, 1, 7, 0, 5);
        RelocateFixed(p, 0x700000, 18, 11, 6, 14, 17, 16, 5, 8, 10, 12, 0, 4, 3, 2, 7, 9, 15, 13, 1);
    }

    public static void Garou(byte[] p)
    {
        DataSwap(p, 13, 12, 14, 10, 8, 2, 3, 1, 5, 9, 11, 4, 15, 0, 6, 7);
        RelocateFixed(p, 0x710000, 18, 4, 5, 16, 14, 7, 9, 6, 13, 17, 15, 3, 1, 2, 12, 11, 8, 10, 0);
        BankedSwap(p, 0x800000, 0x8000, 9, 4, 8, 3, 13, 6, 2, 7, 0, 12, 1, 11, 10, 5);
    }

    public static void Garouh(byte[] p)
    {
        DataSwap(p, 14, 5, 1, 11, 7, 4, 10, 15, 3, 12, 8, 13, 0, 2, 9, 6);
        RelocateFixed(p, 0x7f8000, 18, 5, 16, 11, 2, 6, 7, 17, 3, 12, 8, 14, 4, 0, 9, 1, 10, 15, 13);
        BankedSwap(p, 0x800000, 0x8000, 12, 8, 1, 7, 11, 3, 13, 10, 6, 9, 5, 4, 0, 2);
    }

    public static void Mslug3(byte[] p)
    {
        DataSwap(p, 4, 11, 14, 3, 1, 13, 0, 7, 2, 8, 12, 15, 10, 9, 5, 6);
        RelocateFixed(p, 0x5d0000, 18, 15, 2, 1, 13, 3, 0, 9, 6, 16, 4, 11, 5, 7, 12, 17, 14, 10, 8);
        BankedSwap(p, 0x800000, 0x10000, 2, 11, 0, 14, 6, 4, 13, 8, 9, 3, 10, 7, 5, 12, 1);
    }

    public static void Mslug3a(byte[] p)
    {
        DataSwap(p, 2, 11, 12, 14, 9, 3, 1, 4, 13, 7, 6, 8, 10, 15, 0, 5);
        RelocateFixed(p, 0x5d0000, 18, 1, 16, 14, 7, 17, 5, 8, 4, 15, 6, 3, 2, 0, 13, 10, 12, 9, 11);
        BankedSwap(p, 0x800000, 0x10000, 12, 0, 11, 3, 4, 13, 6, 8, 14, 7, 5, 2, 10, 9, 1);
    }

    public static void Kof2000(byte[] p)
    {
        DataSwap(p, 12, 8, 11, 3, 15, 14, 7, 0, 10, 13, 6, 5, 9, 2, 1, 4);
        BankedSwap(p, 0x63a000, 0x800, 4, 1, 3, 8, 6, 2, 7, 0, 9, 5);
        RelocateFixed(p, 0x73a000, 18, 8, 4, 15, 13, 3, 14, 16, 2, 6, 17, 7, 12, 10, 0, 5, 11, 1, 9);
    }

    static int[] Pad(params int[] o) { var a = new int[64]; o.CopyTo(a, 0); return a; }

    public static readonly SmaConfig Kof99Config = new(0x2ffff0, new[] { 5, 12, 10, 8, 6, 14 }, Pad(
        0x000000, 0x100000, 0x200000, 0x300000, 0x3cc000, 0x4cc000, 0x3f2000, 0x4f2000,
        0x407800, 0x507800, 0x40d000, 0x50d000, 0x417800, 0x517800, 0x420800, 0x520800,
        0x424800, 0x524800, 0x429000, 0x529000, 0x42e800, 0x52e800, 0x431800, 0x531800,
        0x54d000, 0x551000, 0x567000, 0x592800, 0x588800, 0x581800, 0x599800, 0x594800,
        0x598000), 0x2ffff8, 0x2ffffa);

    public static readonly SmaConfig GarouConfig = new(0x2fffc0, new[] { 12, 14, 6, 7, 9, 5 }, Pad(
        0x000000, 0x100000, 0x200000, 0x300000, 0x280000, 0x380000, 0x2d0000, 0x3d0000,
        0x2f0000, 0x3f0000, 0x400000, 0x500000, 0x420000, 0x520000, 0x440000, 0x540000,
        0x498000, 0x598000, 0x4a0000, 0x5a0000, 0x4a8000, 0x5a8000, 0x4b0000, 0x5b0000,
        0x4b8000, 0x5b8000, 0x4c0000, 0x5c0000, 0x4c8000, 0x5c8000, 0x4d0000, 0x5d0000,
        0x458000, 0x558000, 0x460000, 0x560000, 0x468000, 0x568000, 0x470000, 0x570000,
        0x478000, 0x578000, 0x480000, 0x580000, 0x488000, 0x588000, 0x490000, 0x590000,
        0x5d0000, 0x5d8000, 0x5e0000, 0x5e8000, 0x5f0000, 0x5f8000, 0x600000), 0x2fffcc, 0x2ffff0);

    public static readonly SmaConfig GarouhConfig = new(0x2fffc0, new[] { 13, 11, 2, 14, 8, 4 }, Pad(
        0x000000, 0x100000, 0x200000, 0x300000, 0x280000, 0x380000, 0x2d0000, 0x3d0000,
        0x2c8000, 0x3c8000, 0x400000, 0x500000, 0x420000, 0x520000, 0x440000, 0x540000,
        0x598000, 0x698000, 0x5a0000, 0x6a0000, 0x5a8000, 0x6a8000, 0x5b0000, 0x6b0000,
        0x5b8000, 0x6b8000, 0x5c0000, 0x6c0000, 0x5c8000, 0x6c8000, 0x5d0000, 0x6d0000,
        0x458000, 0x558000, 0x460000, 0x560000, 0x468000, 0x568000, 0x470000, 0x570000,
        0x478000, 0x578000, 0x480000, 0x580000, 0x488000, 0x588000, 0x490000, 0x590000,
        0x5d8000, 0x6d8000, 0x5e0000, 0x6e0000, 0x5e8000, 0x6e8000, 0x6e8000), 0x2fffcc, 0x2ffff0);

    public static readonly SmaConfig Mslug3Config = new(0x2fffe4, new[] { 9, 3, 6, 15, 12, 14 }, Pad(
        0x000000, 0x020000, 0x040000, 0x060000, 0x070000, 0x090000, 0x0b0000, 0x0d0000,
        0x0e0000, 0x0f0000, 0x120000, 0x130000, 0x140000, 0x150000, 0x180000, 0x190000,
        0x1a0000, 0x1b0000, 0x1e0000, 0x1f0000, 0x200000, 0x210000, 0x240000, 0x250000,
        0x260000, 0x270000, 0x2a0000, 0x2b0000, 0x2c0000, 0x2d0000, 0x300000, 0x310000,
        0x320000, 0x330000, 0x360000, 0x370000, 0x380000, 0x390000, 0x3c0000, 0x3d0000,
        0x400000, 0x410000, 0x440000, 0x450000, 0x460000, 0x470000, 0x4a0000, 0x4b0000,
        0x4c0000), 0, 0);

    public static readonly SmaConfig Mslug3aConfig = new(0x2fffe4, new[] { 11, 12, 6, 1, 3, 15 }, Pad(
        0x000000, 0x030000, 0x040000, 0x070000, 0x080000, 0x0a0000, 0x0c0000, 0x0e0000,
        0x0f0000, 0x100000, 0x130000, 0x140000, 0x150000, 0x160000, 0x190000, 0x1a0000,
        0x1b0000, 0x1c0000, 0x1f0000, 0x200000, 0x210000, 0x220000, 0x250000, 0x260000,
        0x270000, 0x280000, 0x2b0000, 0x2c0000, 0x2d0000, 0x2e0000, 0x310000, 0x320000,
        0x330000, 0x340000, 0x370000, 0x380000, 0x390000, 0x3a0000, 0x3d0000, 0x3e0000,
        0x400000, 0x410000, 0x440000, 0x450000, 0x460000, 0x470000, 0x4a0000, 0x4b0000,
        0x4c0000), 0, 0);

    public static readonly SmaConfig Kof2000Config = new(0x2fffec, new[] { 5, 10, 3, 7, 14, 15 }, Pad(
        0x000000, 0x100000, 0x200000, 0x300000, 0x3f7800, 0x4f7800, 0x3ff800, 0x4ff800,
        0x407800, 0x507800, 0x40f800, 0x50f800, 0x416800, 0x516800, 0x41d800, 0x51d800,
        0x424000, 0x524000, 0x523800, 0x623800, 0x526000, 0x626000, 0x528000, 0x628000,
        0x52a000, 0x62a000, 0x52b800, 0x62b800, 0x52d000, 0x62d000, 0x52e800, 0x62e800,
        0x618000, 0x619000, 0x61a000, 0x61a800), 0x2fffd8, 0x2fffda);
}

/// <summary>NEO-PCM2: ADPCM (V ROM) encryption.</summary>
static class Pcm2
{
    /// <summary>Swaps the two halves of every <paramref name="value"/>-byte block (in 16-bit words).</summary>
    public static void Decrypt(byte[] ym, int value)
    {
        int words = value / 2, half = value / 4;
        var buffer = new byte[value];
        for (int i = 0; i + value <= ym.Length; i += value)
        {
            Array.Copy(ym, i, buffer, 0, value);
            for (int j = 0; j < words; j++)
            {
                ym[i + 2 * j] = buffer[2 * (j ^ half)];
                ym[i + 2 * j + 1] = buffer[2 * (j ^ half) + 1];
            }
        }
    }

    static readonly int[,] Addrs =
    {
        {0x000000,0xa5000}, {0xffce20,0x01000}, {0xfe2cf6,0x4e001}, {0xffac28,0xc2000},
        {0xfeb2c0,0x0a000}, {0xff14ea,0xa7001}, {0xffb440,0x02000},
    };

    static readonly byte[,] XorData =
    {
        {0xf9,0xe0,0x5d,0xf3,0xea,0x92,0xbe,0xef}, {0xc4,0x83,0xa8,0x5f,0x21,0x27,0x64,0xaf},
        {0xc3,0xfd,0x81,0xac,0x6d,0xe7,0xbf,0x9e}, {0xc3,0xfd,0x81,0xac,0x6d,0xe7,0xbf,0x9e},
        {0xcb,0x29,0x7d,0x43,0xd2,0x3a,0xc2,0xb4}, {0x4b,0xa4,0x63,0x46,0xf0,0x91,0xea,0x62},
        {0x4b,0xa4,0x63,0x46,0xf0,0x91,0xea,0x62},
    };

    /// <summary>The later PCM2 carts also scramble the first 16MB.</summary>
    public static void Swap(byte[] ym, int value)
    {
        var buf = new byte[0x1000000];
        Array.Copy(ym, buf, 0x1000000);
        for (int i = 0; i < 0x1000000; i++)
        {
            int j = Protection.BitSwap(i, 23, 22, 21, 20, 19, 18, 17, 0, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 16);
            j ^= Addrs[value, 1];
            int d = (i + Addrs[value, 0]) & 0xffffff;
            ym[j] = (byte)(buf[d] ^ XorData[value, j & 7]);
        }
    }
}

/// <summary>KOF2002-type carts: the 68k program is stored in shuffled 512KB blocks.</summary>
static class Kof2002
{
    static void Blocks(byte[] p, int start, int length, int[] sec)
    {
        var dst = new byte[length];
        Array.Copy(p, start, dst, 0, length);
        for (int i = 0; i < sec.Length; i++) Array.Copy(dst, sec[i], p, start + i * 0x80000, 0x80000);
    }

    public static void Program(byte[] p) => Blocks(p, 0x100000, 0x400000,
        new[] { 0x100000, 0x280000, 0x300000, 0x180000, 0x000000, 0x380000, 0x200000, 0x080000 });

    public static void Samsho5(byte[] p) => Blocks(p, 0, 0x800000,
        new[] { 0x000000, 0x080000, 0x700000, 0x680000, 0x500000, 0x180000, 0x200000, 0x480000,
                0x300000, 0x780000, 0x600000, 0x280000, 0x100000, 0x580000, 0x400000, 0x380000 });

    public static void Samsh5sp(byte[] p) => Blocks(p, 0, 0x800000,
        new[] { 0x000000, 0x080000, 0x500000, 0x480000, 0x600000, 0x580000, 0x700000, 0x280000,
                0x100000, 0x680000, 0x400000, 0x780000, 0x200000, 0x380000, 0x300000, 0x180000 });
}
