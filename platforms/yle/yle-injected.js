// ================================
// SECTION: WebVtt Parser
// imported and adapted from https://github.com/w3c/webvtt.js/blob/main/parser.js
// ================================

const defaultCueSettings = {
    direction: "horizontal",
    snapToLines: true,
    linePosition: "auto",
    lineAlign: "start",
    textPosition: "auto",
    positionAlign: "auto",
    size: 100,
    alignment: "center",
};

const WebVTTParser = function (entities) {
    if (!entities) {
        entities = {
            "&amp": "&",
            "&lt": "<",
            "&gt": ">",
            "&lrm": "\u200e",
            "&rlm": "\u200f",
            "&nbsp": "\u00A0"
        }
    }
    this.entities = entities
    this.parse = function (input, mode) {
        // global search and replace for \0
        input = input.replace(/\0/g, '\uFFFD');
        var NEWLINE = /\r\n|\r|\n/,
            startTime = Date.now(),
            linePos = 0,
            lines = input.split(NEWLINE),
            alreadyCollected = false,
            styles = [],
            cues = [],
            errors = []
        function err(message, col) {
            errors.push({ message: message, line: linePos + 1, col: col })
        }

        var line = lines[linePos],
            lineLength = line.length,
            signature = "WEBVTT",
            bom = 0,
            signature_length = signature.length

        /* Byte order mark */
        if (line[0] === "\ufeff") {
            bom = 1
            signature_length += 1
        }
        /* SIGNATURE */
        if (
            lineLength < signature_length ||
            line.indexOf(signature) !== 0 + bom ||
            lineLength > signature_length &&
            line[signature_length] !== " " &&
            line[signature_length] !== "\t"
        ) {
            err("No valid signature. (File needs to start with \"WEBVTT\".)")
        }

        linePos++

        /* HEADER */
        while (lines[linePos] != "" && lines[linePos] != undefined) {
            err("No blank line after the signature.")
            if (lines[linePos].indexOf("-->") != -1) {
                alreadyCollected = true
                break
            }
            linePos++
        }

        /* CUE LOOP */
        while (lines[linePos] != undefined) {
            var cue
            while (!alreadyCollected && lines[linePos] == "") {
                linePos++
            }
            if (!alreadyCollected && lines[linePos] == undefined)
                break

            /* CUE CREATION */
            cue = Object.assign({}, defaultCueSettings, {
                id: "",
                startTime: 0,
                endTime: 0,
                pauseOnExit: false,
                direction: "horizontal",
                snapToLines: true,
                linePosition: "auto",
                lineAlign: "start",
                textPosition: "auto",
                positionAlign: "auto",
                size: 100,
                alignment: "center",
                text: "",
                tree: null
            })

            var parseTimings = true

            if (lines[linePos].indexOf("-->") == -1) {
                cue.id = lines[linePos]

                /* COMMENTS
                   Not part of the specification's parser as these would just be ignored. However,
                   we want them to be conforming and not get "Cue identifier cannot be standalone".
                 */
                if (/^NOTE($|[ \t])/.test(cue.id)) { // .startsWith fails in Chrome
                    linePos++
                    while (lines[linePos] != "" && lines[linePos] != undefined) {
                        if (lines[linePos].indexOf("-->") != -1)
                            err("Cannot have timestamp in a comment.")
                        linePos++
                    }
                    continue
                }

                /* STYLES */
                if (/^STYLE($|[ \t])/.test(cue.id)) {
                    var style = []
                    var invalid = false
                    linePos++
                    while (lines[linePos] != "" && lines[linePos] != undefined) {
                        if (lines[linePos].indexOf("-->") != -1) {
                            err("Cannot have timestamp in a style block.")
                            invalid = true
                        }
                        style.push(lines[linePos])
                        linePos++
                    }
                    if (cues.length) {
                        err("Style blocks cannot appear after the first cue.")
                        continue
                    }
                    if (!invalid) {
                        styles.push(style.join('\n'))
                    }
                    continue
                }

                linePos++

                if (lines[linePos] == "" || lines[linePos] == undefined) {
                    err("Cue identifier cannot be standalone.")
                    continue
                }

                if (lines[linePos].indexOf("-->") == -1) {
                    parseTimings = false
                    err("Cue identifier needs to be followed by timestamp.")
                    continue
                }
            }

            /* TIMINGS */
            alreadyCollected = false
            var timings = new WebVTTCueTimingsAndSettingsParser(lines[linePos], err)
            var previousCueStart = 0
            if (cues.length > 0) {
                previousCueStart = cues[cues.length - 1].startTime
            }
            if (parseTimings && !timings.parse(cue, previousCueStart)) {
                /* BAD CUE */

                cue = null
                linePos++

                /* BAD CUE LOOP */
                while (lines[linePos] != "" && lines[linePos] != undefined) {
                    if (lines[linePos].indexOf("-->") != -1) {
                        alreadyCollected = true
                        break
                    }
                    linePos++
                }
                continue
            }
            linePos++

            /* CUE TEXT LOOP */
            while (lines[linePos] != "" && lines[linePos] != undefined) {
                if (lines[linePos].indexOf("-->") != -1) {
                    err("Blank line missing before cue.")
                    alreadyCollected = true
                    break
                }
                if (cue.text != "")
                    cue.text += "\n"
                cue.text += lines[linePos]
                linePos++
            }

            /* CUE TEXT PROCESSING */
            var cuetextparser = new WebVTTCueTextParser(cue.text, err, mode, entities)
            cue.tree = cuetextparser.parse(cue.startTime, cue.endTime)
            cues.push(cue)
        }
        cues.sort(function (a, b) {
            if (a.startTime < b.startTime)
                return -1
            if (a.startTime > b.startTime)
                return 1
            if (a.endTime > b.endTime)
                return -1
            if (a.endTime < b.endTime)
                return 1
            return 0
        })
        /* END */
        return { cues: cues, errors: errors, time: Date.now() - startTime, styles: styles }
    }
}

const WebVTTCueTimingsAndSettingsParser = function (line, errorHandler) {
    var SPACE = /[\u0020\t\f]/,
        NOSPACE = /[^\u0020\t\f]/,
        line = line,
        pos = 0,
        err = function (message) {
            errorHandler(message, pos + 1)
        },
        spaceBeforeSetting = true
    function skip(pattern) {
        while (
            line[pos] != undefined &&
            pattern.test(line[pos])
        ) {
            pos++
        }
    }
    function collect(pattern) {
        var str = ""
        while (
            line[pos] != undefined &&
            pattern.test(line[pos])
        ) {
            str += line[pos]
            pos++
        }
        return str
    }
    /* http://dev.w3.org/html5/webvtt/#collect-a-webvtt-timestamp */
    function timestamp() {
        var units = "minutes",
            val1,
            val2,
            val3,
            val4
        // 3
        if (line[pos] == undefined) {
            err("No timestamp found.")
            return
        }
        // 4
        if (!/\d/.test(line[pos])) {
            err("Timestamp must start with a character in the range 0-9.")
            return
        }
        // 5-7
        val1 = collect(/\d/)
        if (val1.length > 2 || parseInt(val1, 10) > 59) {
            units = "hours"
        }
        // 8
        if (line[pos] != ":") {
            err("No time unit separator found.")
            return
        }
        pos++
        // 9-11
        val2 = collect(/\d/)
        if (val2.length != 2) {
            err("Must be exactly two digits.")
            return
        }
        // 12
        if (units == "hours" || line[pos] == ":") {
            if (line[pos] != ":") {
                err("No seconds found or minutes is greater than 59.")
                return
            }
            pos++
            val3 = collect(/\d/)
            if (val3.length != 2) {
                err("Must be exactly two digits.")
                return
            }
        } else {
            if (val1.length != 2) {
                err("Must be exactly two digits.")
                return
            }
            val3 = val2
            val2 = val1
            val1 = "0"
        }
        // 13
        if (line[pos] != ".") {
            err("No decimal separator (\".\") found.")
            return
        }
        pos++
        // 14-16
        val4 = collect(/\d/)
        if (val4.length != 3) {
            err("Milliseconds must be given in three digits.")
            return
        }
        // 17
        if (parseInt(val2, 10) > 59) {
            err("You cannot have more than 59 minutes.")
            return
        }
        if (parseInt(val3, 10) > 59) {
            err("You cannot have more than 59 seconds.")
            return
        }
        return parseInt(val1, 10) * 60 * 60 + parseInt(val2, 10) * 60 + parseInt(val3, 10) + parseInt(val4, 10) / 1000
    }

    /* http://dev.w3.org/html5/webvtt/#parse-the-webvtt-settings */
    function parseSettings(input, cue) {
        var settings = input.split(SPACE),
            seen = []
        for (var i = 0; i < settings.length; i++) {
            if (settings[i] == "")
                continue

            var index = settings[i].indexOf(':'),
                setting = settings[i].slice(0, index),
                value = settings[i].slice(index + 1)

            if (seen.indexOf(setting) != -1) {
                err("Duplicate setting.")
            }
            seen.push(setting)

            if (value == "") {
                err("No value for setting defined.")
                return
            }

            if (setting == "vertical") { // writing direction
                if (value != "rl" && value != "lr") {
                    err("Writing direction can only be set to 'rl' or 'lr'.")
                    continue
                }
                cue.direction = value
            } else if (setting == "line") { // line position and optionally line alignment
                if (/,/.test(value)) {
                    var comp = value.split(',')
                    value = comp[0]
                    var lineAlign = comp[1]
                }
                if (!/^[-\d](\d*)(\.\d+)?%?$/.test(value)) {
                    err("Line position takes a number or percentage.")
                    continue
                }
                if (value.indexOf("-", 1) != -1) {
                    err("Line position can only have '-' at the start.")
                    continue
                }
                if (value.indexOf("%") != -1 && value.indexOf("%") != value.length - 1) {
                    err("Line position can only have '%' at the end.")
                    continue
                }
                if (value[0] == "-" && value[value.length - 1] == "%") {
                    err("Line position cannot be a negative percentage.")
                    continue
                }
                var numVal = value;
                var isPercent = false;
                if (value[value.length - 1] == "%") {
                    isPercent = true;
                    numVal = value.slice(0, value.length - 1)
                    if (parseInt(value, 10) > 100) {
                        err("Line position cannot be >100%.")
                        continue
                    }
                }
                if (numVal === '' || isNaN(numVal) || !isFinite(numVal)) {
                    err("Line position needs to be a number")
                    continue
                }
                if (lineAlign !== undefined) {
                    if (!["start", "center", "end"].includes(lineAlign)) {
                        err("Line alignment needs to be one of start, center or end")
                        continue
                    }
                    cue.lineAlign = lineAlign
                }
                cue.snapToLines = !isPercent;
                cue.linePosition = parseFloat(numVal)
                if (parseFloat(numVal).toString() !== numVal) {
                    cue.nonSerializable = true;
                }
            } else if (setting == "position") { // text position and optional positionAlign
                if (/,/.test(value)) {
                    var comp = value.split(',')
                    value = comp[0]
                    var positionAlign = comp[1]
                }
                if (value[value.length - 1] != "%") {
                    err("Text position must be a percentage.")
                    continue
                }
                if (parseInt(value, 10) > 100 || parseInt(value, 10) < 0) {
                    err("Text position needs to be between 0 and 100%.")
                    continue
                }
                numVal = value.slice(0, value.length - 1)
                if (numVal === '' || isNaN(numVal) || !isFinite(numVal)) {
                    err("Line position needs to be a number")
                    continue
                }
                if (positionAlign !== undefined) {
                    if (!["line-left", "center", "line-right"].includes(positionAlign)) {
                        err("Position alignment needs to be one of line-left, center or line-right")
                        continue
                    }
                    cue.positionAlign = positionAlign
                }
                cue.textPosition = parseFloat(numVal)
            } else if (setting == "size") { // size
                if (value[value.length - 1] != "%") {
                    err("Size must be a percentage.")
                    continue
                }
                if (parseInt(value, 10) > 100) {
                    err("Size cannot be >100%.")
                    continue
                }
                var size = value.slice(0, value.length - 1)
                if (size === undefined || size === "" || isNaN(size)) {
                    err("Size needs to be a number")
                    size = 100
                    continue
                } else {
                    size = parseFloat(size)
                    if (size < 0 || size > 100) {
                        err("Size needs to be between 0 and 100%.")
                        continue;
                    }
                }
                cue.size = size
            } else if (setting == "align") { // alignment
                var alignValues = ["start", "center", "end", "left", "right"]
                if (alignValues.indexOf(value) == -1) {
                    err("Alignment can only be set to one of " + alignValues.join(", ") + ".")
                    continue
                }
                cue.alignment = value
            } else {
                err("Invalid setting.")
            }
        }
    }

    this.parse = function (cue, previousCueStart) {
        skip(SPACE)
        cue.startTime = timestamp()
        if (cue.startTime == undefined) {
            return
        }
        if (cue.startTime < previousCueStart) {
            err("Start timestamp is not greater than or equal to start timestamp of previous cue.")
        }
        if (NOSPACE.test(line[pos])) {
            err("Timestamp not separated from '-->' by whitespace.")
        }
        skip(SPACE)
        // 6-8
        if (line[pos] != "-") {
            err("No valid timestamp separator found.")
            return
        }
        pos++
        if (line[pos] != "-") {
            err("No valid timestamp separator found.")
            return
        }
        pos++
        if (line[pos] != ">") {
            err("No valid timestamp separator found.")
            return
        }
        pos++
        if (NOSPACE.test(line[pos])) {
            err("'-->' not separated from timestamp by whitespace.")
        }
        skip(SPACE)
        cue.endTime = timestamp()
        if (cue.endTime == undefined) {
            return
        }
        if (cue.endTime <= cue.startTime) {
            err("End timestamp is not greater than start timestamp.")
        }

        if (NOSPACE.test(line[pos])) {
            spaceBeforeSetting = false
        }
        skip(SPACE)
        parseSettings(line.substring(pos), cue)
        return true
    }
    this.parseTimestamp = function () {
        var ts = timestamp()
        if (line[pos] != undefined) {
            err("Timestamp must not have trailing characters.")
            return
        }
        return ts
    }
}

const WebVTTCueTextParser = function (line, errorHandler, mode, entities) {
    this.entities = entities
    var self = this
    var line = line,
        pos = 0,
        err = function (message) {
            if (mode == "metadata")
                return
            errorHandler(message, pos + 1)
        }

    this.parse = function (cueStart, cueEnd) {
        function removeCycles(tree) {
            const cyclelessTree = { ...tree };
            if (tree.children) {
                cyclelessTree.children = tree.children.map(removeCycles);
            }
            if (cyclelessTree.parent) {
                delete cyclelessTree.parent;
            }
            return cyclelessTree;
        }

        var result = { children: [] },
            current = result,
            timestamps = []

        function attach(token) {
            current.children.push({ type: "object", name: token[1], classes: token[2], children: [], parent: current })
            current = current.children[current.children.length - 1]
        }
        function inScope(name) {
            var node = current
            while (node) {
                if (node.name == name)
                    return true
                node = node.parent
            }
            return
        }

        while (line[pos] != undefined) {
            var token = nextToken()
            if (token[0] == "text") {
                current.children.push({ type: "text", value: token[1], parent: current })
            } else if (token[0] == "start tag") {
                if (mode == "chapters")
                    err("Start tags not allowed in chapter title text.")
                var name = token[1]
                if (name != "v" && name != "lang" && token[3] != "") {
                    err("Only <v> and <lang> can have an annotation.")
                }
                if (
                    name == "c" ||
                    name == "i" ||
                    name == "b" ||
                    name == "u" ||
                    name == "ruby"
                ) {
                    attach(token)
                } else if (name == "rt" && current.name == "ruby") {
                    attach(token)
                } else if (name == "v") {
                    if (inScope("v")) {
                        err("<v> cannot be nested inside itself.")
                    }
                    attach(token)
                    current.value = token[3] // annotation
                    if (!token[3]) {
                        err("<v> requires an annotation.")
                    }
                } else if (name == "lang") {
                    attach(token)
                    current.value = token[3] // language
                } else {
                    err("Incorrect start tag.")
                }
            } else if (token[0] == "end tag") {
                if (mode == "chapters")
                    err("End tags not allowed in chapter title text.")
                // XXX check <ruby> content
                if (token[1] == current.name) {
                    current = current.parent
                } else if (token[1] == "ruby" && current.name == "rt") {
                    current = current.parent.parent
                } else {
                    err("Incorrect end tag.")
                }
            } else if (token[0] == "timestamp") {
                if (mode == "chapters")
                    err("Timestamp not allowed in chapter title text.")
                var timings = new WebVTTCueTimingsAndSettingsParser(token[1], err),
                    timestamp = timings.parseTimestamp()
                if (timestamp != undefined) {
                    if (timestamp <= cueStart || timestamp >= cueEnd) {
                        err("Timestamp must be between start timestamp and end timestamp.")
                    }
                    if (timestamps.length > 0 && timestamps[timestamps.length - 1] >= timestamp) {
                        err("Timestamp must be greater than any previous timestamp.")
                    }
                    current.children.push({ type: "timestamp", value: timestamp, parent: current })
                    timestamps.push(timestamp)
                }
            }
        }
        while (current.parent) {
            if (current.name != "v") {
                err("Required end tag missing.")
            }
            current = current.parent
        }
        return removeCycles(result)
    }

    function nextToken() {
        var state = "data",
            result = "",
            buffer = "",
            classes = []
        while (line[pos - 1] != undefined || pos == 0) {
            var c = line[pos]
            if (state == "data") {
                if (c == "&") {
                    buffer = c
                    state = "escape"
                } else if (c == "<" && result == "") {
                    state = "tag"
                } else if (c == "<" || c == undefined) {
                    return ["text", result]
                } else {
                    result += c
                }
            } else if (state == "escape") {
                if (c == "<" || c == undefined) {
                    err("Incorrect escape.")
                    let m;
                    if (m = buffer.match(/^&#([0-9]+)$/)) {
                        result += String.fromCharCode(m[1])
                    } else {
                        if (self.entities[buffer]) {
                            result += self.entities[buffer]
                        } else {
                            result += buffer
                        }
                    }
                    return ["text", result]
                } else if (c == "&") {
                    err("Incorrect escape.")
                    result += buffer
                    buffer = c
                } else if (/[a-z#0-9]/i.test(c)) {
                    buffer += c
                } else if (c == ";") {
                    let m;
                    if (m = buffer.match(/^&#(x?[0-9]+)$/)) {
                        // we prepend "0" so that x20 be interpreted as hexadecim (0x20)
                        result += String.fromCharCode("0" + m[1])
                    } else if (self.entities[buffer + c]) {
                        result += self.entities[buffer + c]
                    } else if (m = Object.keys(entities).find(n => buffer.startsWith(n))) { // partial match
                        result += self.entities[m] + buffer.slice(m.length) + c
                    } else {
                        err("Incorrect escape.")
                        result += buffer + ";"
                    }
                    state = "data"
                } else {
                    err("Incorrect escape.")
                    result += buffer + c
                    state = "data"
                }
            } else if (state == "tag") {
                if (c == "\t" || c == "\n" || c == "\f" || c == " ") {
                    state = "start tag annotation"
                } else if (c == ".") {
                    state = "start tag class"
                } else if (c == "/") {
                    state = "end tag"
                } else if (/\d/.test(c)) {
                    result = c
                    state = "timestamp tag"
                } else if (c == ">" || c == undefined) {
                    if (c == ">") {
                        pos++
                    }
                    return ["start tag", "", [], ""]
                } else {
                    result = c
                    state = "start tag"
                }
            } else if (state == "start tag") {
                if (c == "\t" || c == "\f" || c == " ") {
                    state = "start tag annotation"
                } else if (c == "\n") {
                    buffer = c
                    state = "start tag annotation"
                } else if (c == ".") {
                    state = "start tag class"
                } else if (c == ">" || c == undefined) {
                    if (c == ">") {
                        pos++
                    }
                    return ["start tag", result, [], ""]
                } else {
                    result += c
                }
            } else if (state == "start tag class") {
                if (c == "\t" || c == "\f" || c == " ") {
                    if (buffer) {
                        classes.push(buffer)
                    }
                    buffer = ""
                    state = "start tag annotation"
                } else if (c == "\n") {
                    if (buffer) {
                        classes.push(buffer)
                    }
                    buffer = c
                    state = "start tag annotation"
                } else if (c == ".") {
                    if (buffer) {
                        classes.push(buffer)
                    }
                    buffer = ""
                } else if (c == ">" || c == undefined) {
                    if (c == ">") {
                        pos++
                    }
                    if (buffer) {
                        classes.push(buffer)
                    }
                    return ["start tag", result, classes, ""]
                } else {
                    buffer += c
                }
            } else if (state == "start tag annotation") {
                if (c == ">" || c == undefined) {
                    if (c == ">") {
                        pos++
                    }
                    buffer = buffer.split(/[\u0020\t\f\r\n]+/).filter(function (item) { if (item) return true }).join(" ")
                    return ["start tag", result, classes, buffer]
                } else {
                    buffer += c
                }
            } else if (state == "end tag") {
                if (c == ">" || c == undefined) {
                    if (c == ">") {
                        pos++
                    }
                    return ["end tag", result]
                } else {
                    result += c
                }
            } else if (state == "timestamp tag") {
                if (c == ">" || c == undefined) {
                    if (c == ">") {
                        pos++
                    }
                    return ["timestamp", result]
                } else {
                    result += c
                }
            } else {
                err("Never happens.") // The joke is it might.
            }
            // 8
            pos++
        }
    }
}

const WebVTTSerializer = function () {
    function serializeTimestamp(seconds) {
        const ms = ("00" + (seconds - Math.floor(seconds)).toFixed(3) * 1000).slice(-3);
        let h = 0, m = 0, s = 0;
        if (seconds >= 3600) {
            h = Math.floor(seconds / 3600);
        }
        m = Math.floor((seconds - 3600 * h) / 60);
        s = Math.floor(seconds - 3600 * h - 60 * m);
        return (h ? h + ":" : "") + ("" + m).padStart(2, "0") + ":" + ("" + s).padStart(2, "0") + "." + ms;
    }
    function serializeCueSettings(cue) {
        var result = ""
        const nonDefaultSettings = Object.keys(defaultCueSettings).filter(s => cue[s] !== defaultCueSettings[s]);
        if (nonDefaultSettings.includes("direction")) {
            result += " vertical:" + cue.direction
        }
        if (nonDefaultSettings.includes("alignment")) {
            result += " align:" + cue.alignment
        }
        if (nonDefaultSettings.includes("size")) {
            result += " size:" + cue.size + "%"
        }
        if (nonDefaultSettings.includes("lineAlign") || nonDefaultSettings.includes("linePosition")) {
            result += " line:" + cue.linePosition + (cue.snapToLines ? "" : "%") + (cue.lineAlign && cue.lineAlign != defaultCueSettings.lineAlign ? "," + cue.lineAlign : "")
        }
        if (nonDefaultSettings.includes("textPosition") || nonDefaultSettings.includes("positionAlign")) {
            result += " position:" + cue.textPosition + "%" + (cue.positionAlign && cue.positionAlign !== defaultCueSettings.positionAlign ? "," + cue.positionAlign : "")
        }
        return result
    }
    function serializeTree(tree) {
        var result = ""
        for (var i = 0; i < tree.length; i++) {
            var node = tree[i]
            if (node.type == "text") {
                result += node.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            } else if (node.type == "object") {
                result += "<" + node.name
                if (node.classes) {
                    for (var y = 0; y < node.classes.length; y++) {
                        result += "." + node.classes[y]
                    }
                }
                if (node.value) {
                    result += " " + node.value
                }
                result += ">"
                if (node.children)
                    result += serializeTree(node.children)
                result += "</" + node.name + ">"
            } else if (node.type == "timestamp") {
                result += "<" + serializeTimestamp(node.value) + ">"
            } else {
                result += "<" + node.value + ">"
            }
        }
        return result
    }
    function serializeCue(cue) {
        return (cue.id !== undefined ? cue.id + "\n" : "")
            + serializeTimestamp(cue.startTime)
            + " --> "
            + serializeTimestamp(cue.endTime)
            + serializeCueSettings(cue)
            + "\n" + serializeTree(cue.tree.children) + "\n\n"
    }
    function serializeStyle(style) {
        return "STYLE\n" + style + "\n\n"
    }
    this.serialize = function (cues, styles) {
        var result = "WEBVTT\n\n"
        if (styles) {
            for (var i = 0; i < styles.length; i++) {
                result += serializeStyle(styles[i])
            }
        }
        for (var i = 0; i < cues.length; i++) {
            result += serializeCue(cues[i])
        }
        return result
    }
}

// ================================
// End section
// ================================

// ================================
// SECTION: Language Detection
// ================================

/**
 * Heuristic language detection from subtitle text
 * Detects Finnish, Swedish, English and other common languages
 */
const LanguageDetector = {
  // Language patterns with common words and special characters
  patterns: {
    fi: {
      // Finnish: common words and special characters ä, ö
      words: /\b(minä|sinä|hän|me|te|he|on|ovat|oli|olisi|olla|ja|tai|mutta|että|kun|jos|niin|kuin|mitä|mikä|missä|miksi|koska|kanssa|joka|jotka|myös|vain|sitten|nyt|tässä|täällä|siellä|tuolla|tänne|sinne|tänään|huomenna|eilen|aina|koskaan|joskus|ehkä|pitää|täytyy|voida|haluta|tietää|nähdä|kuulla|sanoa|mennä|tulla|ottaa|antaa)\b/gi,
      chars: /[äöÄÖ]/,
      weight: 0
    },
    sv: {
      // Swedish: common words and special character å
      words: /\b(jag|du|han|hon|den|det|vi|ni|de|är|var|vara|har|hade|och|eller|men|att|när|om|så|som|vad|vilken|var|varför|för|med|på|av|till|från|också|bara|sedan|nu|här|där|dit|idag|imorgon|igår|alltid|aldrig|ibland|kanske|måste|kan|vill|vet|ser|hör|säger|går|kommer|tar|ger)\b/gi,
      chars: /[åÅ]/,
      weight: 0
    },
    en: {
      // English: common words
      words: /\b(the|a|an|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|could|should|can|may|might|must|shall|and|or|but|if|then|else|when|where|why|how|what|which|who|this|that|these|those|here|there|now|just|only|also|very|really|always|never|sometimes|maybe|want|need|know|think|see|hear|say|go|come|take|give|get|make|let|put|use|find|tell)\b/gi,
      chars: null, // No special chars
      weight: 0
    },
    de: {
      // German: common words and special characters ü, ß
      words: /\b(ich|du|er|sie|es|wir|ihr|ist|sind|war|waren|sein|haben|hat|hatte|und|oder|aber|wenn|dann|weil|dass|als|wie|was|wer|wo|warum|für|mit|auf|von|zu|aus|auch|nur|noch|schon|jetzt|hier|dort|heute|morgen|gestern|immer|nie|manchmal|vielleicht|müssen|können|wollen|wissen|sehen|hören|sagen|gehen|kommen|nehmen|geben)\b/gi,
      chars: /[üÜßäöÄÖ]/,
      weight: 0
    },
    fr: {
      // French: common words
      words: /\b(je|tu|il|elle|nous|vous|ils|elles|est|sont|était|étaient|être|avoir|a|ont|avait|et|ou|mais|si|alors|parce|que|quand|où|pourquoi|comment|qui|quoi|ce|cette|ces|ici|là|maintenant|seulement|aussi|très|vraiment|toujours|jamais|parfois|peut-être|vouloir|devoir|pouvoir|savoir|voir|entendre|dire|aller|venir|prendre|donner)\b/gi,
      chars: /[éèêëàâäùûüïîôœçÉÈÊËÀÂÄÙÛÜÏÎÔŒÇ]/,
      weight: 0
    }
  },

  // Track detected language to avoid repeated detection
  _detected: null,
  _sampleCount: 0,
  _maxSamples: 5,

  /**
   * Detect language from a text sample
   * @param {string} text - Text to analyze
   * @returns {string|null} - Detected language code or null
   */
  detect(text) {
    if (!text || typeof text !== 'string') return null;

    // Reset weights for fresh detection
    for (const lang in this.patterns) {
      this.patterns[lang].weight = 0;
    }

    const lowerText = text.toLowerCase();

    // Check each language pattern
    for (const lang in this.patterns) {
      const pattern = this.patterns[lang];

      // Count word matches
      const wordMatches = lowerText.match(pattern.words);
      if (wordMatches) {
        pattern.weight += wordMatches.length * 2;
      }

      // Check for special characters (strong indicator)
      if (pattern.chars && pattern.chars.test(text)) {
        pattern.weight += 5;
      }
    }

    // Find language with highest weight
    let maxWeight = 0;
    let detectedLang = null;

    for (const lang in this.patterns) {
      if (this.patterns[lang].weight > maxWeight) {
        maxWeight = this.patterns[lang].weight;
        detectedLang = lang;
      }
    }

    // Only return if we have reasonable confidence (weight >= 3)
    return maxWeight >= 3 ? detectedLang : null;
  },

  /**
   * Process subtitle batch and detect language
   * @param {Array} subtitles - Array of subtitle objects with text property
   * @returns {string|null} - Detected language code or null
   */
  detectFromBatch(subtitles) {
    if (this._detected && this._sampleCount >= this._maxSamples) {
      // Already confidently detected
      return this._detected;
    }

    if (!subtitles || subtitles.length === 0) return this._detected;

    // Sample first few subtitles for detection
    const sampleSize = Math.min(10, subtitles.length);
    const sampleText = subtitles
      .slice(0, sampleSize)
      .map(s => s.text || '')
      .join(' ');

    const detected = this.detect(sampleText);

    if (detected) {
      this._sampleCount++;
      if (!this._detected) {
        this._detected = detected;
        console.info('DualSubExtension: [YLE] Language detected:', detected);

        // Dispatch event for content script
        const event = new CustomEvent('yleSourceLanguageDetected', {
          bubbles: true,
          detail: { language: detected }
        });
        document.dispatchEvent(event);
      }
    }

    return this._detected;
  },

  /**
   * Reset detection state (for new video)
   */
  reset() {
    this._detected = null;
    this._sampleCount = 0;
  }
};

// ================================
// End Language Detection
// ================================

const decoder = new TextDecoder("utf-8");
const vttParser = new WebVTTParser();

function collectSubtitlesFromVttText(vttText) {
    const vttFileTree = vttParser.parse(vttText);
    const subtitles = [];

    for (const cue of vttFileTree.cues) {
        if (!cue || typeof cue.text !== "string") {
            continue;
        }
        const subtitle = cue.text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
        if (subtitle.length > 0) {
            subtitles.push({
                text: subtitle,
                startTime: cue.startTime,
                endTime: cue.endTime
            });
        }
    }

    return subtitles;
}

function dispatchBatchTranslation(subtitles, source = '') {
    if (subtitles.length === 0) {
        return;
    }

    LanguageDetector.detectFromBatch(subtitles);

    const batchEvent = new CustomEvent("sendBatchTranslationEvent", {
        bubbles: true,
        cancelable: true,
        detail: {
            subtitles
        }
    });
    document.dispatchEvent(batchEvent);

    const sourcePrefix = source ? `[${source}] ` : '';
    console.info(`YleDualSubExtension: ${sourcePrefix}Sent batch of ${subtitles.length} subtitles for translation (lang: ${LanguageDetector._detected || 'unknown'})`);
}

(function () {
    const XHR = XMLHttpRequest.prototype;

    const open = XHR.open;
    const send = XHR.send;

    XHR.open = function (method, url) {
        this._method = method;
        this._url = url;

        return open.apply(this, arguments);
    };

    XHR.send = function (_postData) {
        this.addEventListener("load", function () {

            if (typeof this._url !== "string") {
                return;
            }
            /** @type {string} */
            const requestedUrl = this._url.toLowerCase();
            if (!requestedUrl.endsWith(".vtt")) {
                return;
            }

            try {
                const fullVttFileResponseText = decoder.decode(this.response);
                const allSubtitles = collectSubtitlesFromVttText(fullVttFileResponseText);
                dispatchBatchTranslation(allSubtitles);
            } catch (e) {
                console.error("YleDualSubExtension: Failed to parse VTT file:", e);
            }
        });

        return send.apply(this, arguments);
    };
})();

// Also intercept fetch API for VTT files (modern video players often use fetch)
(function () {
    const originalFetch = window.fetch;

    window.fetch = async function (input) {
        const response = await originalFetch.apply(this, arguments);

        // Get the URL from the input
        let url = '';
        if (typeof input === 'string') {
            url = input;
        } else if (input instanceof Request) {
            url = input.url;
        }

        // Check if this is a VTT file
        if (url.toLowerCase().endsWith('.vtt')) {
            try {
                // Clone the response so we can read it without consuming the original
                const clonedResponse = response.clone();
                const text = await clonedResponse.text();
                const allSubtitles = collectSubtitlesFromVttText(text);
                dispatchBatchTranslation(allSubtitles, 'fetch');
            } catch (e) {
                console.error("YleDualSubExtension: [fetch] Failed to parse VTT file:", e);
            }
        }

        return response;
    };
})();
