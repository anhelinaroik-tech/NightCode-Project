export type ThemeColors = {
    primary: string;
    planMode: string; 
    selection: string; 
    thinking: string; 
    success: string; 
    error: string; 
    info: string;
    background: string;
    surface: string;
    dialogSurface: string; 
    thinkingBorder: string; 
    toolName: string;
    dimSeparator: string;
};

export type Theme = {
    name: string;
    colors: ThemeColors;
};

export const THEMES: Theme[] = [
    {
        name: "Nightfox",
        colors:{
            primary: "#56D6C2",
            planMode: "#CF8EF4",
            selection: "#89B4FA",
            thinking: "#CF8EF4", 
            success: "#82E0AA",
            error:"#E74C5E",
            info:"#56D6C2",
            background: "#0D0D12",
            surface: "#1A1A24",
            dialogSurface: "#0A0A10", 
            thinkingBorder:"#34344A",
            toolName: "#738091",
            dimSeparator:"#4E4E66",
        },
    },
    {
        name: "Dracula",
        colors:{
            primary: "#BD93F9",
            planMode: "#FF79C6",
            selection: "#8BE9FD",
            thinking: "#FF79C6",
            success: "#50FA7B",
            error:"#FF5555",
            info:"#8BE9FD",
            background: "#282A36",
            surface: "#343746",
            dialogSurface: "#21222C",
            thinkingBorder:"#44475A",
            toolName: "#6272A4",
            dimSeparator:"#6272A4",
        },
    },
    {
        name: "Nord",
        colors:{
            primary: "#88C0D0",
            planMode: "#B48EAD",
            selection: "#81A1C1",
            thinking: "#B48EAD",
            success: "#A3BE8C",
            error:"#BF616A",
            info:"#88C0D0",
            background: "#2E3440",
            surface: "#3B4252",
            dialogSurface: "#272C36",
            thinkingBorder:"#434C5E",
            toolName: "#616E88",
            dimSeparator:"#4C566A",
        },
    },
    {
        name: "Gruvbox",
        colors:{
            primary: "#FABD2F",
            planMode: "#D3869B",
            selection: "#83A598",
            thinking: "#D3869B",
            success: "#B8BB26",
            error:"#FB4934",
            info:"#83A598",
            background: "#282828",
            surface: "#3C3836",
            dialogSurface: "#1D2021",
            thinkingBorder:"#504945",
            toolName: "#928374",
            dimSeparator:"#665C54",
        },
    },
    {
        name: "Tokyo Night",
        colors:{
            primary: "#7AA2F7",
            planMode: "#BB9AF7",
            selection: "#7DCFFF",
            thinking: "#BB9AF7",
            success: "#9ECE6A",
            error:"#F7768E",
            info:"#7DCFFF",
            background: "#1A1B26",
            surface: "#24283B",
            dialogSurface: "#16161E",
            thinkingBorder:"#292E42",
            toolName: "#565F89",
            dimSeparator:"#565F89",
        },
    },
    {
        name: "Catppuccin Mocha",
        colors:{
            primary: "#CBA6F7",
            planMode: "#F5C2E7",
            selection: "#89B4FA",
            thinking: "#F5C2E7",
            success: "#A6E3A1",
            error:"#F38BA8",
            info:"#89DCEB",
            background: "#1E1E2E",
            surface: "#313244",
            dialogSurface: "#181825",
            thinkingBorder:"#45475A",
            toolName: "#7F849C",
            dimSeparator:"#6C7086",
        },
    },
    {
        name: "One Dark",
        colors:{
            primary: "#61AFEF",
            planMode: "#C678DD",
            selection: "#61AFEF",
            thinking: "#C678DD",
            success: "#98C379",
            error:"#E06C75",
            info:"#56B6C2",
            background: "#282C34",
            surface: "#2C313C",
            dialogSurface: "#21252B",
            thinkingBorder:"#3E4451",
            toolName: "#5C6370",
            dimSeparator:"#5C6370",
        },
    },
    {
        name: "Solarized Dark",
        colors:{
            primary: "#2AA198",
            planMode: "#6C71C4",
            selection: "#268BD2",
            thinking: "#D33682",
            success: "#859900",
            error:"#DC322F",
            info:"#2AA198",
            background: "#002B36",
            surface: "#073642",
            dialogSurface: "#00212B",
            thinkingBorder:"#094352",
            toolName: "#586E75",
            dimSeparator:"#586E75",
        },
    },
    {
        name: "Rosé Pine",
        colors:{
            primary: "#EBBCBA",
            planMode: "#C4A7E7",
            selection: "#9CCFD8",
            thinking: "#C4A7E7",
            success: "#9CCFD8",
            error:"#EB6F92",
            info:"#31748F",
            background: "#191724",
            surface: "#1F1D2E",
            dialogSurface: "#16141F",
            thinkingBorder:"#26233A",
            toolName: "#6E6A86",
            dimSeparator:"#6E6A86",
        },
    },
    {
        name: "Everforest",
        colors:{
            primary: "#A7C080",
            planMode: "#D699B6",
            selection: "#7FBBB3",
            thinking: "#D699B6",
            success: "#A7C080",
            error:"#E67E80",
            info:"#7FBBB3",
            background: "#2D353B",
            surface: "#343F44",
            dialogSurface: "#232A2E",
            thinkingBorder:"#475258",
            toolName: "#859289",
            dimSeparator:"#859289",
        },
    },
    {
        name: "Kanagawa",
        colors:{
            primary: "#7E9CD8",
            planMode: "#957FB8",
            selection: "#7FB4CA",
            thinking: "#957FB8",
            success: "#98BB6C",
            error:"#E46876",
            info:"#7FB4CA",
            background: "#1F1F28",
            surface: "#2A2A37",
            dialogSurface: "#16161D",
            thinkingBorder:"#363646",
            toolName: "#727169",
            dimSeparator:"#54546D",
        },
    },
];

export const DEFAULT_THEME = THEMES.find((t)=> t.name === "Nightfox")!;