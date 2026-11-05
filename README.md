# Universal RF Remote for Homey Pro

Send 433 MHz codes captured with a [Flipper Zero](https://flipperzero.one) from your Homey Pro. Create a remote control device, add as many buttons as you like with your own labels, and give each button a code – by letting Homey listen to the remote, by loading the `.sub` file the Flipper saved, or by typing in the protocol, key, bit count, TE and frequency exactly as the Flipper shows them.

## Features

- **Remote control device** with a chosen name, icon and device type, and up to 16 labelled buttons.
- **Listen:** Homey listens to your remote and decodes the code itself (18 protocols on 433.92 MHz, see below).
- **Codes from Flipper Zero `.sub` files** (Key, RAW and BinRAW) or entered by hand, each with a *Test* button during pairing.
- **34 fixed-code protocols** rebuilt from the decoded values the same way the Flipper does: Princeton, CAME, Nice FLO, Holtek, Holtek_HT12X, Linear, LinearDelta3, GateTX, Cham_Code, MegaCode, Ansonic, SMC5326, Phoenix_V2, Power Smart, BETT, Doitrand, Intertechno_V3, Clemsa, Dooya, Hormann HSM, Marantec, Marantec24, Mastercode, Legrand, Dickert_MAHS, Magellan, Feron, Nero Radio, Nero Sketch, Honeywell, Elplast, Roger, Telcoma/Cardin EDGE and Doorbell32.
- **Real device types:** give buttons a function (Up, Stop, Down, On, Off, Toggle) and the device gets Homey's own controls – window covering for awnings, blinds and curtains, garage door, or on/off for lights, sockets and fans. They work in the Homey app, in zones and with voice assistants. With a *travel time* in the device settings, Homey estimates the position and can move an awning or blind to e.g. 50 % (for awnings 100 % means fully out, for blinds and curtains fully open).
- **Listen for the physical remote:** turn it on in the device settings, and Homey recognises the remote's own buttons. The flow card *[button] was pressed on the physical remote* starts, and Homey's controls follow along, so an awning's position stays right when it is moved with its own remote. Homey only receives while at least one device has the setting turned on.
- **Flow cards:** *Press a button*, *A button is pressed*, *[button] was pressed on the physical remote* and *Send a 433 MHz code*.
- **Repair device** to add, remove, relabel and reorder buttons or change codes.
- 13 languages: English, Dutch, German, French, Italian, Swedish, Norwegian, Spanish, Danish, Russian, Polish, Korean and Arabic.

## Limitations

- Homey Pro (Early 2023) transmits on **433.00–433.99 MHz** with AM/OOK only. 868 MHz and FM/FSK recordings are not supported.
- **Rolling-code remotes** (KeeLoq, Somfy RTS, Nice FloR-S, CAME Atomo, Security+ …) cannot be replayed. The app refuses them with an explanation.
- **Listen** and **Listen for the physical remote** only hear 433.76–434.08 MHz (433.92 MHz remotes) and decodes Princeton, CAME, Nice FLO, Holtek, Holtek_HT12X, SMC5326, Legrand, GateTX, Intertechno_V3, Ansonic, Doitrand, Dickert_MAHS, Phoenix_V2, Magellan, Feron, Honeywell, Nero Sketch, Cham_Code and Doorbell32. Homey's receiver drops the last pulse before a long pause, so protocols that keep a bit there (Linear, LinearDelta3, Roger, Dooya, Mastercode …) and Manchester-coded ones need a `.sub` file. Holtek_HT12X with TE 320 or 700 µs looks the same on air as CAME or Nice FLO and may be shown as those – the code works either way.
- A frame can hold at most 256 pulses (a Homey radio limit). Long RAW recordings are reduced to one clean repetition automatically.

## Guide

There are four ways to get a code: let Homey listen to your remote, read it with a Flipper Zero, download a ready-made `.sub` file, or type in the values. Try Homey's own 433 MHz learning first – this app is for the remotes it cannot learn.

### 1. Read your remote with a Flipper Zero

1. On the Flipper, open **Sub-GHz → Read**. The default is 433.92 MHz, AM650, which suits most remotes. For other frequencies (e.g. 433.42 MHz), press left for **Config** and change *Frequency*.
2. Hold the remote close to the Flipper and press the button once.
3. The Flipper shows what it decoded, for example:

   ```
   Princeton 24bit
   Key:0x005A3C91
   Te:211us
   ```

   The frequency is shown at the top of the screen. If you see a message about a dynamic or rolling code (KeeLoq, Somfy, Security+ …), the remote cannot be copied.
4. Press **More → Save** and name the file after the button (e.g. `Awning_In`). Repeat for each button.
5. If nothing is decoded, use **Sub-GHz → Read RAW** instead: press *REC*, press the button on the remote, press *Stop* and *Save*. RAW recordings work too, but a decoded code is more reliable.

Saved files are in `SD Card/subghz/` and can be viewed again under **Sub-GHz → Saved** (choose a file and *Info*).

**Tip – use the Flipper to decode and test.** A Flipper Zero is the easiest way to work with these codes. It decodes the remote for you (protocol, key, bits, TE), so you do not have to guess the values. It also lets you test them:

- **Before Homey:** open the file under **Sub-GHz → Saved** and choose **Emulate**, then press the button. If the device reacts, the code is right and will work from Homey too.
- **After Homey:** hold the Flipper near Homey in **Sub-GHz → Read** and press **Test** on the pairing page. The Flipper should show the same protocol and key as your remote. If it does, Homey sends the correct code. If the device still does not react, it is a range or repetition problem, not a wrong code.

### 2. Get the file off the Flipper – or note the values

- **Phone:** in the Flipper mobile app (iOS/Android), connect over Bluetooth, open **Archive**, choose the file and **share** it to your phone's files.
- **Computer:** connect over USB and use [qFlipper](https://flipperzero.one/update) or [Flipper Lab](https://lab.flipper.net) (file manager → `SD Card/subghz`), or take out the microSD card.
- **No file transfer:** write down the **protocol**, **key**, **bits**, **TE** and **frequency** from the Flipper's screen and type them in (step 4).

### 3. Download a code from the internet

Community collections have thousands of `.sub` files sorted by device type and brand, for example [UberGuidoZ/Flipper – Sub-GHz](https://github.com/UberGuidoZ/Flipper/tree/main/Sub-GHz). Open a file on GitHub, click **Raw** and copy all the text – or download the file to your phone.

A downloaded code only works if your receiver uses exactly that code. Many fixed-code receivers that learn codes from a remote (sockets, doorbells, awning motors) can be paired with a downloaded or invented code: put the receiver in learning mode and press **Test** on the pairing page.

### 4. Add the remote in Homey

1. In the Homey app, go to **Devices → + → Universal RF Remote → Remote control**.
2. Choose a name, an icon and a device type.
3. Tap **+ Add button** for each button and give it a label, e.g. *In*, *Stop*, *Out*.
4. Give the button its code in one of four ways:
   - **.sub file** tab: choose the file. The label is filled in from the file name if it is empty.
   - **.sub file** tab: paste the file contents into the box below the file picker.
   - **● Listen** tab: tap **Start listening**, hold the remote close to Homey and press its button a few times. When the code is decoded, the page switches to **Enter** with the values filled in.
   - **Enter** tab: pick the protocol and type the key, bits, TE and frequency as the Flipper showed them, then tap **Use these values**. The key may be written as `0x5A3C91`, `5A3C91` or `00 00 00 00 00 5A 3C 91`. For RAW, paste the `RAW_Data` numbers instead.
5. Optional: choose a device type such as *Awning*, *Socket* or *Light* and give each button its **Function** (e.g. *In* → Up, *Stop* → Stop, *Out* → Down). For position control, set **Travel time** in the device settings afterwards (time from fully in to fully out).
6. Tap **Test** next to each button and check that the device reacts. If it does not, try more *Repetitions*.
7. Finish with **Add device**.

Use the buttons on the device tile or in flows (*Press a button*, *A button is pressed*). To start flows from the remote itself, turn on **Listen for the physical remote** in the device settings and use *[button] was pressed on the physical remote*. To add, remove, relabel or reorder buttons or change codes later, open the device settings and choose **Repair device**.

## How it works

Homey apps cannot send raw pulse lists: every transmission must use a signal defined in `app.json`, where a signal is a set of `[high, low]` "words" in µs and a frame is a list of word indexes. `scripts/build.js` therefore generates a catalogue of ~312 signals:

- `p_<protocol>_<kHz>` – the exact pulse pairs for each fixed-timing protocol,
- `te<TE>_<kHz>` – protocols whose timing comes from the file (Princeton and friends) in 10/25 µs steps,
- `grid_<kHz>` – a generic 24×32 log-spaced table used for RAW recordings and as a fallback,

for the carriers 433.92, 433.42 and 433.07 MHz. At runtime `lib/radio.js` encodes the code to pulses (`lib/protocols.js`), picks the best signal and maps the pulses to word indexes.

Receiving works the same way in reverse. Homey only reports which words of a signal it recognised, so **Listen** turns on two generic 18×18 tables (`rx_a`, `rx_b`, offset by half a step) and converts the word indexes back to µs. `lib/decode.js` then uses the encoders as templates: each bit changes fixed positions in the frame, so the received timings are compared with the 0 and 1 version of every bit, and a result is accepted only if the whole re-encoded frame matches. Three frames must agree.

**Listen for the physical remote** keeps the same tables on while a device has the setting turned on. `lib/match.js` runs each button's code through a simulated reception once, so it knows which decoded code Homey will hear (this also covers RAW recordings and protocols that Homey hears as another one). Two matching frames from the same table count as a press, and a new press starts after 0.7 s of silence. While Homey transmits a code, and for 1.5 s afterwards, that code is ignored, so Homey does not hear itself.

## Development

```sh
npm test                    # self-test of the pure logic in lib/
node scripts/build.js       # regenerate signals in app.json and copy views/remote.html to the driver
homey app validate --level publish
homey app install
```

Edit the pairing page in `views/remote.html` – the copies in `drivers/remote/pair` and `repair` are overwritten by the build script.

## Credits and license

The protocol encoders are ported from the Sub-GHz implementation in the [Flipper Zero firmware](https://github.com/flipperdevices/flipperzero-firmware) by Flipper Devices Inc. (GPL-3.0); Telcoma/Cardin EDGE and Doorbell32 come from the [Unleashed firmware](https://github.com/DarkFlippers/unleashed-firmware) (GPL-3.0). Universal RF Remote is an independent app and is not affiliated with Flipper Devices.

Licensed under the GNU General Public License v3.0 – see [LICENSE](LICENSE).

Bug reports and suggestions: [GitHub issues](https://github.com/bosund/universal-rf-remote/issues).
